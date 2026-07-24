"""Central capture ingest service — upload from robots, query metadata, serve files."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import UUID

import asyncpg
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "/data/captures")).resolve()
DATABASE_URL = os.environ["DATABASE_URL"]
API_KEYS = {k.strip() for k in os.environ.get("API_KEYS", "").split(",") if k.strip()}
POSE_ARCHIVE = os.environ.get("POSE_ARCHIVE", "true").lower() in ("1", "true", "yes")
DETECTION_ARCHIVE = os.environ.get("DETECTION_ARCHIVE", "true").lower() in ("1", "true", "yes")

CHUNK_INSERT_BATCH = 1000

pool: asyncpg.Pool | None = None


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not API_KEYS:
        return
    if not x_api_key or x_api_key not in API_KEYS:
        raise HTTPException(status_code=401, detail="invalid or missing API key")


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------

UNSAFE_NAME = re.compile(r"[/\\]|\.\.")

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".wav"}

MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".wav": "audio/wav",
    ".json": "application/json",
}


def safe_filename(name: str) -> str:
    base = Path(name).name
    if not base or UNSAFE_NAME.search(base):
        raise HTTPException(status_code=400, detail=f"unsafe filename: {name!r}")
    ext = Path(base).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"unsupported file type: {ext or '(none)'}")
    return base


def is_wav(filename: str) -> bool:
    return Path(filename).suffix.lower() == ".wav"


def validate_trigger_files(trigger: str, filenames: list[str]) -> None:
    wav_files = [f for f in filenames if is_wav(f)]
    non_wav = [f for f in filenames if not is_wav(f)]
    if trigger == "wakeword" and non_wav:
        raise HTTPException(status_code=400, detail="wakeword sessions must contain only .wav files")
    if trigger != "wakeword" and wav_files:
        raise HTTPException(status_code=400, detail="non-wakeword sessions cannot contain .wav files")


def media_type_for_path(path: Path) -> str:
    return MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream")


def session_storage_rel(robot_id: int, started_at: datetime, session_id: str) -> str:
    day = started_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
    return f"robot_{robot_id}/{day}/{session_id}"


def resolve_storage_path(rel_path: str) -> Path:
    rel = Path(rel_path)
    if rel.is_absolute() or ".." in rel.parts:
        raise HTTPException(status_code=400, detail="invalid storage path")
    full = (STORAGE_ROOT / rel).resolve()
    try:
        full.relative_to(STORAGE_ROOT)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid storage path") from exc
    return full


def write_bytes(path: Path, data: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_bytes(data)
    except OSError as exc:
        if exc.errno == 28:  # ENOSPC
            raise HTTPException(status_code=507, detail="disk full") from exc
        raise
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Manifest parsing
# ---------------------------------------------------------------------------

def parse_iso8601(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    return datetime.fromisoformat(text)


def frame_field(frame: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in frame:
            return frame[key]
    pose = frame.get("pose")
    if isinstance(pose, dict):
        for key in keys:
            if key in pose:
                return pose[key]
    ros_time = frame.get("ros_time")
    if isinstance(ros_time, dict):
        for key in keys:
            if key in ros_time:
                return ros_time[key]
    return default


def parse_manifest(raw: bytes, header_robot_id: int) -> dict[str, Any]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="manifest is not valid JSON") from exc

    for field in ("schema_version", "status", "robot_id", "session_id", "trigger", "started_at", "frames"):
        if field not in data:
            raise HTTPException(status_code=400, detail=f"manifest missing {field}")

    if data["status"] != "ready_for_upload":
        raise HTTPException(status_code=400, detail="manifest status must be ready_for_upload")

    if int(data["robot_id"]) != header_robot_id:
        raise HTTPException(status_code=400, detail="robot_id mismatch")

    started_at = parse_iso8601(data["started_at"])
    if started_at is None:
        raise HTTPException(status_code=400, detail="invalid started_at")

    frames = data["frames"]
    if not isinstance(frames, list) or not frames:
        raise HTTPException(status_code=400, detail="frames must be a non-empty list")

    try:
        session_uuid = str(UUID(str(data["session_id"])))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid session_id") from exc

    return {
        "robot_id": int(data["robot_id"]),
        "session_id": session_uuid,
        "trigger": str(data["trigger"]),
        "started_at": started_at,
        "ended_at": parse_iso8601(data.get("ended_at")),
        "frames": frames,
    }


def normalize_frame(frame: dict[str, Any], session_rel: str) -> dict[str, Any]:
    filename = safe_filename(str(frame["filename"]))
    frame_id = str(frame.get("frame_id") or filename)
    file_rel = f"{session_rel}/{filename}"

    detections = frame.get("detections", [])
    extra = frame.get("extra", {})
    if not isinstance(detections, list):
        detections = []
    if not isinstance(extra, dict):
        extra = {}

    return {
        "frame_id": frame_id,
        "filename": filename,
        "storage_path": file_rel,
        "ros_time_sec": int(frame_field(frame, "ros_time_sec", "sec", default=0)),
        "ros_time_nsec": int(frame_field(frame, "ros_time_nsec", "nsec", default=0)),
        "wall_time": parse_iso8601(frame.get("wall_time")),
        "pose_x": frame_field(frame, "pose_x", "x"),
        "pose_y": frame_field(frame, "pose_y", "y"),
        "pose_theta": frame_field(frame, "pose_theta", "theta"),
        "detections": detections,
        "extra": extra,
    }


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

# Applied on startup so existing Postgres volumes pick up new tables without
# re-running docker-entrypoint-initdb.d (which only runs on first volume init).
ROBOT_POSES_SCHEMA = """
CREATE TABLE IF NOT EXISTS robot_poses (
  id            BIGSERIAL PRIMARY KEY,
  robot_id      INTEGER NOT NULL,
  wall_time     TIMESTAMPTZ NOT NULL,
  ros_time_sec  BIGINT,
  ros_time_nsec INTEGER,
  x             DOUBLE PRECISION,
  y             DOUBLE PRECISION,
  theta         DOUBLE PRECISION,
  frame         TEXT,
  ref_x         DOUBLE PRECISION,
  ref_y         DOUBLE PRECISION,
  ref_theta     DOUBLE PRECISION,
  is_static     BOOLEAN NOT NULL,
  valid         BOOLEAN NOT NULL,
  chunk_id      TEXT,
  uploaded_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (robot_id, wall_time)
);
CREATE INDEX IF NOT EXISTS idx_robot_poses_robot_time ON robot_poses (robot_id, wall_time);
"""

DETECTION_SNAPSHOTS_SCHEMA = """
CREATE TABLE IF NOT EXISTS detection_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  robot_id        INTEGER NOT NULL,
  chunk_id        TEXT NOT NULL,
  wall_time       TIMESTAMPTZ NOT NULL,
  ros_time_sec    BIGINT,
  ros_time_nsec   INTEGER,
  robot_x         DOUBLE PRECISION,
  robot_y         DOUBLE PRECISION,
  robot_theta     DOUBLE PRECISION,
  robot_frame     TEXT,
  robot_valid     BOOLEAN NOT NULL,
  object_count    INTEGER NOT NULL,
  objects         JSONB NOT NULL,
  uploaded_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (robot_id, wall_time, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_detection_snapshots_robot_time
  ON detection_snapshots (robot_id, wall_time);
CREATE INDEX IF NOT EXISTS idx_detection_objects
  ON detection_snapshots USING GIN (objects);
"""


# Deface columns for existing volumes (fresh installs get these from schema.sql).
DEFACE_SCHEMA = """
ALTER TABLE captures
  ADD COLUMN IF NOT EXISTS deface_status TEXT NOT NULL DEFAULT 'n/a',
  ADD COLUMN IF NOT EXISTS deface_error TEXT,
  ADD COLUMN IF NOT EXISTS defaced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sha256_original TEXT;
CREATE INDEX IF NOT EXISTS idx_captures_deface_pending
  ON captures (id) WHERE deface_status = 'pending';
"""


async def ensure_schema() -> None:
    assert pool is not None
    async with pool.acquire() as conn:
        await conn.execute(ROBOT_POSES_SCHEMA)
        await conn.execute(DETECTION_SNAPSHOTS_SCHEMA)
        await conn.execute(DEFACE_SCHEMA)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    await ensure_schema()
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    yield
    await pool.close()
    pool = None


async def db_fetch(query: str, *args: Any) -> list[asyncpg.Record]:
    assert pool is not None
    async with pool.acquire() as conn:
        return await conn.fetch(query, *args)


async def db_fetchrow(query: str, *args: Any) -> asyncpg.Record | None:
    assert pool is not None
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, *args)


async def persist_session(
    manifest: dict[str, Any],
    session_rel: str,
    frames: list[dict[str, Any]],
    file_hashes: dict[str, str],
    sha256_originals: dict[str, str] | None = None,
) -> None:
    sha256_originals = sha256_originals or {}
    assert pool is not None
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO robots (id) VALUES ($1) ON CONFLICT DO NOTHING",
                manifest["robot_id"],
            )
            await conn.execute(
                """
                INSERT INTO sessions (id, robot_id, trigger, started_at, ended_at,
                                      status, frame_count, storage_path)
                VALUES ($1, $2, $3, $4, $5, 'complete', $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                    frame_count = EXCLUDED.frame_count,
                    storage_path = EXCLUDED.storage_path,
                    uploaded_at = now()
                """,
                manifest["session_id"],
                manifest["robot_id"],
                manifest["trigger"],
                manifest["started_at"],
                manifest["ended_at"],
                len(frames),
                session_rel,
            )
            for frame in frames:
                needs_deface = is_rgb_jpeg_frame(frame)
                await conn.execute(
                    """
                    INSERT INTO captures (
                        session_id, robot_id, frame_id, filename, storage_path,
                        ros_time_sec, ros_time_nsec, wall_time,
                        pose_x, pose_y, pose_theta, detections, extra,
                        sha256, sha256_original, deface_status
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,
                        $14,$15,$16
                    )
                    ON CONFLICT (session_id, frame_id) DO NOTHING
                    """,
                    manifest["session_id"],
                    manifest["robot_id"],
                    frame["frame_id"],
                    frame["filename"],
                    frame["storage_path"],
                    frame["ros_time_sec"],
                    frame["ros_time_nsec"],
                    frame["wall_time"],
                    frame["pose_x"],
                    frame["pose_y"],
                    frame["pose_theta"],
                    json.dumps(frame["detections"]),
                    json.dumps(frame["extra"]),
                    None if needs_deface else file_hashes.get(frame["filename"]),
                    sha256_originals.get(frame["filename"]) if needs_deface else None,
                    "pending" if needs_deface else "n/a",
                )


async def file_is_registered(rel_path: str) -> bool:
    if await db_fetchrow("SELECT 1 FROM captures WHERE storage_path = $1", rel_path):
        return True
    if Path(rel_path).name == "manifest.json":
        session_rel = str(Path(rel_path).parent)
        return bool(await db_fetchrow(
            "SELECT 1 FROM sessions WHERE storage_path = $1", session_rel
        ))
    return False


def json_value(value: Any) -> Any:
    if isinstance(value, str):
        return json.loads(value)
    return value


def is_ir_frame(frame: dict[str, Any]) -> bool:
    extra = frame.get("extra") or {}
    if extra.get("modality") == "ir":
        return True
    return str(frame.get("filename", "")).endswith("_ir.jpg")


def is_depth_frame(frame: dict[str, Any]) -> bool:
    extra = frame.get("extra") or {}
    if extra.get("modality") == "depth":
        return True
    return str(frame.get("filename", "")).endswith("_depth.png")


def is_companion_frame(frame: dict[str, Any]) -> bool:
    return is_ir_frame(frame) or is_depth_frame(frame)


def is_primary_frame(frame: dict[str, Any]) -> bool:
    return not is_companion_frame(frame)


def is_rgb_jpeg_frame(frame: dict[str, Any]) -> bool:
    """Primary RGB still that must be face-blurred before serving."""
    if not is_primary_frame(frame):
        return False
    return Path(frame.get("filename", "")).suffix.lower() in {".jpg", ".jpeg"}


def raw_filename_for(filename: str) -> str:
    path = Path(filename)
    return f"{path.stem}.raw{path.suffix.lower()}"


def find_companion(
    frames: list[dict[str, Any]],
    by_id: dict[str, dict[str, Any]],
    rgb_frame_id: str,
    suffix: str,
    is_match: Callable[[dict[str, Any]], bool],
) -> dict[str, Any] | None:
    companion = by_id.get(rgb_frame_id + suffix)
    if companion is not None:
        return companion
    return next(
        (
            x for x in frames
            if is_match(x) and (x.get("extra") or {}).get("rgb_frame_id") == rgb_frame_id
        ),
        None,
    )


def build_capture_groups(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {f["frame_id"]: f for f in frames}
    groups: list[dict[str, Any]] = []
    for frame in frames:
        if is_companion_frame(frame):
            continue
        ir = find_companion(frames, by_id, frame["frame_id"], "_ir", is_ir_frame)
        depth = find_companion(frames, by_id, frame["frame_id"], "_depth", is_depth_frame)
        groups.append({"rgb": frame, "ir": ir, "depth": depth})
    return groups


def capture_to_dict(record: asyncpg.Record) -> dict[str, Any]:
    return {
        "frame_id": record["frame_id"],
        "filename": record["filename"],
        "storage_path": record["storage_path"],
        "ros_time_sec": record["ros_time_sec"],
        "ros_time_nsec": record["ros_time_nsec"],
        "wall_time": record["wall_time"].isoformat() if record["wall_time"] else None,
        "pose_x": record["pose_x"],
        "pose_y": record["pose_y"],
        "pose_theta": record["pose_theta"],
        "detections": json_value(record["detections"]),
        "extra": json_value(record["extra"]),
        "sha256": record["sha256"],
        "deface_status": record["deface_status"],
    }


def filter_by_modality(frames: list[dict[str, Any]], modality: str) -> list[dict[str, Any]]:
    if modality == "all":
        return frames
    if modality == "rgb":
        return [f for f in frames if is_primary_frame(f)]
    if modality == "ir":
        return [f for f in frames if is_ir_frame(f)]
    if modality == "depth":
        return [f for f in frames if is_depth_frame(f)]
    raise HTTPException(status_code=400, detail="modality must be all, rgb, ir, or depth")


def parse_session_id(session_id: str) -> str:
    try:
        return str(UUID(session_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid session_id") from exc


async def fetch_session_captures(session_id: str) -> list[asyncpg.Record]:
    parse_session_id(session_id)
    return await db_fetch(
        """
        SELECT frame_id, filename, storage_path, ros_time_sec, ros_time_nsec,
               wall_time, pose_x, pose_y, pose_theta, detections, extra, sha256,
               deface_status
        FROM captures WHERE session_id = $1::uuid
        ORDER BY wall_time NULLS LAST, ros_time_sec, ros_time_nsec
        """,
        session_id,
    )


# ---------------------------------------------------------------------------
# Time-range read API (poses, detections, capture events)
# ---------------------------------------------------------------------------

REPLAY_DEFAULT_LIMIT = 5000
REPLAY_MAX_LIMIT = 20000


def parse_time_range(from_str: str, to_str: str) -> tuple[datetime, datetime]:
    """Half-open interval [from, to)."""
    start = parse_iso8601(from_str)
    end = parse_iso8601(to_str)
    if start is None:
        raise HTTPException(status_code=400, detail="invalid or missing from")
    if end is None:
        raise HTTPException(status_code=400, detail="invalid or missing to")
    if start >= end:
        raise HTTPException(status_code=400, detail="from must be before to")
    return start, end


def pose_row_to_dict(record: asyncpg.Record) -> dict[str, Any]:
    return {
        "wall_time": record["wall_time"].isoformat(),
        "ros_time_sec": record["ros_time_sec"],
        "ros_time_nsec": record["ros_time_nsec"],
        "x": record["x"],
        "y": record["y"],
        "theta": record["theta"],
        "valid": record["valid"],
        "chunk_id": record["chunk_id"],
    }


def detection_row_to_dict(record: asyncpg.Record) -> dict[str, Any]:
    return {
        "wall_time": record["wall_time"].isoformat(),
        "ros_time_sec": record["ros_time_sec"],
        "ros_time_nsec": record["ros_time_nsec"],
        "robot_x": record["robot_x"],
        "robot_y": record["robot_y"],
        "robot_theta": record["robot_theta"],
        "robot_frame": record["robot_frame"],
        "robot_valid": record["robot_valid"],
        "object_count": record["object_count"],
        "objects": json_value(record["objects"]),
        "chunk_id": record["chunk_id"],
    }


def build_capture_events_from_rows(
    rows: list[asyncpg.Record],
    limit: int,
) -> list[dict[str, Any]]:
    """Group session captures into RGB/IR/depth events, sorted by wall_time."""
    by_session: dict[str, list[asyncpg.Record]] = {}
    session_meta: dict[str, dict[str, Any]] = {}
    for row in rows:
        sid = str(row["session_id"])
        by_session.setdefault(sid, []).append(row)
        session_meta[sid] = {"trigger": row["trigger"], "session_id": sid}

    events: list[dict[str, Any]] = []
    for sid, session_rows in by_session.items():
        captures = [capture_to_dict(r) for r in session_rows]
        meta = session_meta[sid]
        for group in build_capture_groups(captures):
            rgb = group["rgb"]
            wall_time = rgb.get("wall_time")
            if not wall_time:
                continue
            events.append({
                "wall_time": wall_time,
                "trigger": meta["trigger"],
                "session_id": meta["session_id"],
                "rgb": group["rgb"],
                "ir": group["ir"],
                "depth": group["depth"],
            })

    events.sort(key=lambda e: e["wall_time"])
    return events[:limit]


# ---------------------------------------------------------------------------
# Chunk upload ingest (pose + detection)
# ---------------------------------------------------------------------------

def safe_chunk_id(chunk_id: str) -> str:
    if not chunk_id or UNSAFE_NAME.search(chunk_id):
        raise HTTPException(status_code=400, detail=f"unsafe chunk_id: {chunk_id!r}")
    return chunk_id


def parse_chunk_meta(raw: bytes, header_robot_id: int) -> dict[str, Any]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="meta is not valid JSON") from exc

    for field in (
        "schema_version", "robot_id", "chunk_id", "started_at",
        "ended_at", "row_count", "status",
    ):
        if field not in data:
            raise HTTPException(status_code=400, detail=f"meta missing {field}")

    if data["schema_version"] != 1:
        raise HTTPException(status_code=400, detail="schema_version must be 1")

    if data["status"] != "ready_for_upload":
        raise HTTPException(status_code=400, detail="meta status must be ready_for_upload")

    if int(data["robot_id"]) != header_robot_id:
        raise HTTPException(status_code=400, detail="robot_id mismatch")

    started_at = parse_iso8601(data["started_at"])
    ended_at = parse_iso8601(data["ended_at"])
    if started_at is None or ended_at is None:
        raise HTTPException(status_code=400, detail="invalid started_at or ended_at")

    chunk_id = safe_chunk_id(str(data["chunk_id"]))

    try:
        row_count = int(data["row_count"])
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid row_count") from exc

    return {
        "robot_id": int(data["robot_id"]),
        "chunk_id": chunk_id,
        "started_at": started_at,
        "ended_at": ended_at,
        "row_count": row_count,
    }


def read_poses_from_sqlite(chunk_bytes: bytes) -> list[dict[str, Any]]:
    if not chunk_bytes:
        raise HTTPException(status_code=400, detail="empty SQLite chunk")

    with tempfile.NamedTemporaryFile(suffix=".sqlite") as tmp:
        tmp.write(chunk_bytes)
        tmp.flush()
        try:
            conn = sqlite3.connect(f"file:{tmp.name}?mode=ro", uri=True)
        except sqlite3.Error as exc:
            raise HTTPException(status_code=400, detail="invalid SQLite chunk") from exc

        with conn:
            table = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='poses'"
            ).fetchone()
            if not table:
                raise HTTPException(status_code=400, detail="SQLite chunk missing poses table")

            try:
                rows = conn.execute(
                    """
                    SELECT wall_time, ros_time_sec, ros_time_nsec, x, y, theta, frame,
                           ref_x, ref_y, ref_theta, is_static, valid
                    FROM poses ORDER BY wall_time
                    """
                ).fetchall()
            except sqlite3.Error as exc:
                raise HTTPException(status_code=400, detail="failed to read poses table") from exc

    poses: list[dict[str, Any]] = []
    for row in rows:
        wall_time = parse_iso8601(row[0])
        if wall_time is None:
            raise HTTPException(status_code=400, detail=f"invalid wall_time: {row[0]!r}")
        poses.append({
            "wall_time": wall_time,
            "ros_time_sec": row[1],
            "ros_time_nsec": row[2],
            "x": row[3],
            "y": row[4],
            "theta": row[5],
            "frame": row[6],
            "ref_x": row[7],
            "ref_y": row[8],
            "ref_theta": row[9],
            "is_static": bool(row[10]),
            "valid": bool(row[11]),
        })
    return poses


def pose_archive_rel(robot_id: int, started_at: datetime, chunk_id: str) -> str:
    day = started_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
    return f"poses/robot_{robot_id}/{day}/{chunk_id}"


def archive_pose_chunk(
    meta: dict[str, Any], meta_bytes: bytes, chunk_bytes: bytes
) -> None:
    rel = pose_archive_rel(meta["robot_id"], meta["started_at"], meta["chunk_id"])
    archive_dir = resolve_storage_path(rel)
    try:
        write_bytes(archive_dir / "chunk.sqlite", chunk_bytes)
        write_bytes(archive_dir / "meta.json", meta_bytes)
    except HTTPException as exc:
        if exc.status_code == 507:
            raise
        return
    except OSError:
        return


async def persist_pose_chunk(
    meta: dict[str, Any], poses: list[dict[str, Any]]
) -> int:
    assert pool is not None
    robot_id = meta["robot_id"]
    chunk_id = meta["chunk_id"]
    rows_accepted = 0

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO robots (id) VALUES ($1) ON CONFLICT DO NOTHING",
                robot_id,
            )

            for i in range(0, len(poses), CHUNK_INSERT_BATCH):
                batch = poses[i : i + CHUNK_INSERT_BATCH]
                n = len(batch)
                robot_ids = [robot_id] * n
                wall_times = [p["wall_time"] for p in batch]
                ros_secs = [p["ros_time_sec"] for p in batch]
                ros_nsecs = [p["ros_time_nsec"] for p in batch]
                xs = [p["x"] for p in batch]
                ys = [p["y"] for p in batch]
                thetas = [p["theta"] for p in batch]
                frames = [p["frame"] for p in batch]
                ref_xs = [p["ref_x"] for p in batch]
                ref_ys = [p["ref_y"] for p in batch]
                ref_thetas = [p["ref_theta"] for p in batch]
                is_statics = [p["is_static"] for p in batch]
                valids = [p["valid"] for p in batch]
                chunk_ids = [chunk_id] * n

                inserted = await conn.fetch(
                    """
                    INSERT INTO robot_poses (
                        robot_id, wall_time, ros_time_sec, ros_time_nsec,
                        x, y, theta, frame, ref_x, ref_y, ref_theta,
                        is_static, valid, chunk_id
                    )
                    SELECT * FROM unnest(
                        $1::int[], $2::timestamptz[], $3::bigint[], $4::int[],
                        $5::float8[], $6::float8[], $7::float8[], $8::text[],
                        $9::float8[], $10::float8[], $11::float8[],
                        $12::bool[], $13::bool[], $14::text[]
                    )
                    ON CONFLICT (robot_id, wall_time) DO NOTHING
                    RETURNING id
                    """,
                    robot_ids,
                    wall_times,
                    ros_secs,
                    ros_nsecs,
                    xs,
                    ys,
                    thetas,
                    frames,
                    ref_xs,
                    ref_ys,
                    ref_thetas,
                    is_statics,
                    valids,
                    chunk_ids,
                )
                rows_accepted += len(inserted)

    return rows_accepted


def read_detections_from_sqlite(chunk_bytes: bytes) -> list[dict[str, Any]]:
    if not chunk_bytes:
        raise HTTPException(status_code=400, detail="empty SQLite chunk")

    with tempfile.NamedTemporaryFile(suffix=".sqlite") as tmp:
        tmp.write(chunk_bytes)
        tmp.flush()
        try:
            conn = sqlite3.connect(f"file:{tmp.name}?mode=ro", uri=True)
        except sqlite3.Error as exc:
            raise HTTPException(status_code=400, detail="invalid SQLite chunk") from exc

        with conn:
            table = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='detection_snapshots'"
            ).fetchone()
            if not table:
                raise HTTPException(
                    status_code=400, detail="SQLite chunk missing detection_snapshots table"
                )

            try:
                rows = conn.execute(
                    """
                    SELECT wall_time, ros_time_sec, ros_time_nsec,
                           robot_x, robot_y, robot_theta, robot_frame, robot_valid,
                           object_count, objects_json
                    FROM detection_snapshots ORDER BY wall_time
                    """
                ).fetchall()
            except sqlite3.Error as exc:
                raise HTTPException(
                    status_code=400, detail="failed to read detection_snapshots table"
                ) from exc

    snapshots: list[dict[str, Any]] = []
    for row in rows:
        wall_time = parse_iso8601(row[0])
        if wall_time is None:
            raise HTTPException(status_code=400, detail=f"invalid wall_time: {row[0]!r}")
        try:
            objects = json.loads(row[9])
        except (TypeError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=400, detail=f"invalid objects_json: {row[9]!r}"
            ) from exc
        if not isinstance(objects, list):
            raise HTTPException(status_code=400, detail="objects_json must be a JSON array")
        snapshots.append({
            "wall_time": wall_time,
            "ros_time_sec": row[1],
            "ros_time_nsec": row[2],
            "robot_x": row[3],
            "robot_y": row[4],
            "robot_theta": row[5],
            "robot_frame": row[6],
            "robot_valid": bool(row[7]),
            "object_count": int(row[8]),
            "objects": objects,
        })
    return snapshots


def detection_archive_rel(robot_id: int, started_at: datetime, chunk_id: str) -> str:
    day = started_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
    return f"detections/robot_{robot_id}/{day}/{chunk_id}"


def archive_detection_chunk(
    meta: dict[str, Any], meta_bytes: bytes, chunk_bytes: bytes
) -> None:
    rel = detection_archive_rel(meta["robot_id"], meta["started_at"], meta["chunk_id"])
    archive_dir = resolve_storage_path(rel)
    try:
        write_bytes(archive_dir / "chunk.sqlite", chunk_bytes)
        write_bytes(archive_dir / "meta.json", meta_bytes)
    except HTTPException as exc:
        if exc.status_code == 507:
            raise
        return
    except OSError:
        return


async def persist_detection_chunk(
    meta: dict[str, Any], snapshots: list[dict[str, Any]]
) -> int:
    assert pool is not None
    robot_id = meta["robot_id"]
    chunk_id = meta["chunk_id"]
    rows_accepted = 0

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO robots (id) VALUES ($1) ON CONFLICT DO NOTHING",
                robot_id,
            )

            for i in range(0, len(snapshots), CHUNK_INSERT_BATCH):
                batch = snapshots[i : i + CHUNK_INSERT_BATCH]
                n = len(batch)
                robot_ids = [robot_id] * n
                chunk_ids = [chunk_id] * n
                wall_times = [s["wall_time"] for s in batch]
                ros_secs = [s["ros_time_sec"] for s in batch]
                ros_nsecs = [s["ros_time_nsec"] for s in batch]
                robot_xs = [s["robot_x"] for s in batch]
                robot_ys = [s["robot_y"] for s in batch]
                robot_thetas = [s["robot_theta"] for s in batch]
                robot_frames = [s["robot_frame"] for s in batch]
                robot_valids = [s["robot_valid"] for s in batch]
                object_counts = [s["object_count"] for s in batch]
                objects_json = [json.dumps(s["objects"]) for s in batch]

                inserted = await conn.fetch(
                    """
                    INSERT INTO detection_snapshots (
                        robot_id, chunk_id, wall_time, ros_time_sec, ros_time_nsec,
                        robot_x, robot_y, robot_theta, robot_frame, robot_valid,
                        object_count, objects
                    )
                    SELECT * FROM unnest(
                        $1::int[], $2::text[], $3::timestamptz[], $4::bigint[], $5::int[],
                        $6::float8[], $7::float8[], $8::float8[], $9::text[], $10::bool[],
                        $11::int[], $12::jsonb[]
                    )
                    ON CONFLICT (robot_id, wall_time, chunk_id) DO NOTHING
                    RETURNING id
                    """,
                    robot_ids,
                    chunk_ids,
                    wall_times,
                    ros_secs,
                    ros_nsecs,
                    robot_xs,
                    robot_ys,
                    robot_thetas,
                    robot_frames,
                    robot_valids,
                    object_counts,
                    objects_json,
                )
                rows_accepted += len(inserted)

    return rows_accepted


# ---------------------------------------------------------------------------
# App + routes
# ---------------------------------------------------------------------------

app = FastAPI(title="Robot Capture Ingest", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/v1/upload", status_code=201, dependencies=[Depends(require_api_key)])
async def upload(
    manifest: UploadFile = File(...),
    files: list[UploadFile] = File(...),
    x_robot_id: int = Header(..., alias="X-Robot-Id"),
):
    manifest_bytes = await manifest.read()
    parsed = parse_manifest(manifest_bytes, x_robot_id)

    session_rel = session_storage_rel(
        parsed["robot_id"], parsed["started_at"], parsed["session_id"]
    )
    session_dir = resolve_storage_path(session_rel)

    normalized = [normalize_frame(f, session_rel) for f in parsed["frames"]]
    validate_trigger_files(parsed["trigger"], [f["filename"] for f in normalized])
    expected_names = {f["filename"] for f in normalized}

    uploaded: dict[str, bytes] = {}
    for part in files:
        name = safe_filename(part.filename or "")
        if name in uploaded:
            raise HTTPException(status_code=409, detail=f"duplicate upload filename: {name}")
        uploaded[name] = await part.read()

    if uploaded.keys() != expected_names:
        missing = expected_names - uploaded.keys()
        extra = uploaded.keys() - expected_names
        detail = []
        if missing:
            detail.append(f"missing: {sorted(missing)}")
        if extra:
            detail.append(f"unexpected: {sorted(extra)}")
        raise HTTPException(status_code=409, detail="; ".join(detail))

    file_hashes: dict[str, str] = {}
    sha256_originals: dict[str, str] = {}
    # Each manifest frame may be RGB, paired IR (*_ir.jpg), depth (*_depth.png), or wakeword WAV.
    # RGB JPEGs are written as {stem}.raw{suffix}; the deface sidecar produces the final path.
    for frame in normalized:
        data = uploaded[frame["filename"]]
        if is_rgb_jpeg_frame(frame):
            raw_path = session_dir / raw_filename_for(frame["filename"])
            sha256_originals[frame["filename"]] = write_bytes(raw_path, data)
        else:
            path = session_dir / frame["filename"]
            file_hashes[frame["filename"]] = write_bytes(path, data)

    write_bytes(session_dir / "manifest.json", manifest_bytes)
    await persist_session(
        parsed, session_rel, normalized, file_hashes, sha256_originals
    )

    return {
        "ok": True,
        "session_id": parsed["session_id"],
        "files_accepted": len(normalized),
        "storage_path": session_rel,
    }


@app.post("/api/v1/pose_upload", status_code=201, dependencies=[Depends(require_api_key)])
async def pose_upload(
    meta: UploadFile = File(...),
    chunk: UploadFile = File(...),
    x_robot_id: int = Header(..., alias="X-Robot-Id"),
):
    meta_bytes = await meta.read()
    chunk_bytes = await chunk.read()
    parsed = parse_chunk_meta(meta_bytes, x_robot_id)
    poses = read_poses_from_sqlite(chunk_bytes)

    if parsed["row_count"] != len(poses):
        raise HTTPException(
            status_code=409,
            detail=f"row_count mismatch: meta={parsed['row_count']} actual={len(poses)}",
        )

    rows_accepted = await persist_pose_chunk(parsed, poses)

    if POSE_ARCHIVE:
        try:
            archive_pose_chunk(parsed, meta_bytes, chunk_bytes)
        except HTTPException as exc:
            if exc.status_code == 507:
                raise

    return {
        "ok": True,
        "chunk_id": parsed["chunk_id"],
        "rows_accepted": rows_accepted,
    }


@app.post("/api/v1/detection_upload", status_code=201, dependencies=[Depends(require_api_key)])
async def detection_upload(
    meta: UploadFile = File(...),
    chunk: UploadFile = File(...),
    x_robot_id: int = Header(..., alias="X-Robot-Id"),
):
    meta_bytes = await meta.read()
    chunk_bytes = await chunk.read()
    parsed = parse_chunk_meta(meta_bytes, x_robot_id)
    snapshots = read_detections_from_sqlite(chunk_bytes)

    if parsed["row_count"] != len(snapshots):
        raise HTTPException(
            status_code=409,
            detail=f"row_count mismatch: meta={parsed['row_count']} actual={len(snapshots)}",
        )

    rows_accepted = await persist_detection_chunk(parsed, snapshots)

    if DETECTION_ARCHIVE:
        try:
            archive_detection_chunk(parsed, meta_bytes, chunk_bytes)
        except HTTPException as exc:
            if exc.status_code == 507:
                raise

    return {
        "ok": True,
        "chunk_id": parsed["chunk_id"],
        "rows_accepted": rows_accepted,
    }


@app.get("/api/v1/robots", dependencies=[Depends(require_api_key)])
async def list_robots():
    rows = await db_fetch("SELECT id, name, created_at FROM robots ORDER BY id")
    return [
        {"id": r["id"], "name": r["name"], "created_at": r["created_at"].isoformat()}
        for r in rows
    ]


@app.get("/api/v1/robots/{robot_id}/poses", dependencies=[Depends(require_api_key)])
async def list_robot_poses(
    robot_id: int,
    from_time: str = Query(..., alias="from"),
    to_time: str = Query(..., alias="to"),
    limit: int = Query(default=REPLAY_DEFAULT_LIMIT, ge=1, le=REPLAY_MAX_LIMIT),
):
    start, end = parse_time_range(from_time, to_time)
    rows = await db_fetch(
        """
        SELECT wall_time, ros_time_sec, ros_time_nsec, x, y, theta, valid, chunk_id
        FROM robot_poses
        WHERE robot_id = $1 AND wall_time >= $2 AND wall_time < $3
        ORDER BY wall_time ASC
        LIMIT $4
        """,
        robot_id,
        start,
        end,
        limit,
    )
    return {
        "robot_id": robot_id,
        "from": from_time,
        "to": to_time,
        "count": len(rows),
        "poses": [pose_row_to_dict(r) for r in rows],
    }


@app.get("/api/v1/robots/{robot_id}/detections", dependencies=[Depends(require_api_key)])
async def list_robot_detections(
    robot_id: int,
    from_time: str = Query(..., alias="from"),
    to_time: str = Query(..., alias="to"),
    limit: int = Query(default=REPLAY_DEFAULT_LIMIT, ge=1, le=REPLAY_MAX_LIMIT),
    min_object_count: int = Query(default=0, ge=0),
):
    start, end = parse_time_range(from_time, to_time)
    rows = await db_fetch(
        """
        SELECT wall_time, ros_time_sec, ros_time_nsec,
               robot_x, robot_y, robot_theta, robot_frame, robot_valid,
               object_count, objects, chunk_id
        FROM detection_snapshots
        WHERE robot_id = $1 AND wall_time >= $2 AND wall_time < $3
          AND object_count >= $4
        ORDER BY wall_time ASC
        LIMIT $5
        """,
        robot_id,
        start,
        end,
        min_object_count,
        limit,
    )
    return {
        "robot_id": robot_id,
        "from": from_time,
        "to": to_time,
        "count": len(rows),
        "snapshots": [detection_row_to_dict(r) for r in rows],
    }


@app.get("/api/v1/robots/{robot_id}/capture_events", dependencies=[Depends(require_api_key)])
async def list_robot_capture_events(
    robot_id: int,
    from_time: str = Query(..., alias="from"),
    to_time: str = Query(..., alias="to"),
    limit: int = Query(default=REPLAY_DEFAULT_LIMIT, ge=1, le=REPLAY_MAX_LIMIT),
    exclude_trigger: str | None = Query(default="wakeword"),
):
    start, end = parse_time_range(from_time, to_time)
    if exclude_trigger:
        rows = await db_fetch(
            """
            SELECT c.frame_id, c.filename, c.storage_path, c.wall_time,
                   c.ros_time_sec, c.ros_time_nsec, c.pose_x, c.pose_y, c.pose_theta,
                   c.detections, c.extra, c.sha256, c.deface_status,
                   s.id AS session_id, s.trigger
            FROM captures c
            JOIN sessions s ON s.id = c.session_id
            WHERE c.robot_id = $1
              AND c.wall_time >= $2 AND c.wall_time < $3
              AND s.trigger != $4
            ORDER BY c.wall_time ASC
            """,
            robot_id,
            start,
            end,
            exclude_trigger,
        )
    else:
        rows = await db_fetch(
            """
            SELECT c.frame_id, c.filename, c.storage_path, c.wall_time,
                   c.ros_time_sec, c.ros_time_nsec, c.pose_x, c.pose_y, c.pose_theta,
                   c.detections, c.extra, c.sha256, c.deface_status,
                   s.id AS session_id, s.trigger
            FROM captures c
            JOIN sessions s ON s.id = c.session_id
            WHERE c.robot_id = $1
              AND c.wall_time >= $2 AND c.wall_time < $3
            ORDER BY c.wall_time ASC
            """,
            robot_id,
            start,
            end,
        )
    events = build_capture_events_from_rows(rows, limit)
    return {
        "robot_id": robot_id,
        "from": from_time,
        "to": to_time,
        "count": len(events),
        "events": events,
    }


@app.get("/api/v1/sessions", dependencies=[Depends(require_api_key)])
async def list_sessions(
    robot_id: int | None = Query(default=None),
    trigger: str | None = Query(default=None),
    from_time: str | None = Query(default=None, alias="from"),
    to_time: str | None = Query(default=None, alias="to"),
    limit: int = Query(default=50, ge=1, le=500),
):
    conditions: list[str] = []
    args: list[Any] = []
    n = 1
    if robot_id is not None:
        conditions.append(f"robot_id = ${n}")
        args.append(robot_id)
        n += 1
    if trigger is not None:
        conditions.append(f"trigger = ${n}")
        args.append(trigger)
        n += 1
    if from_time is not None or to_time is not None:
        if from_time is None or to_time is None:
            raise HTTPException(
                status_code=400, detail="from and to must both be set for time filtering"
            )
        start, end = parse_time_range(from_time, to_time)
        conditions.append(f"started_at >= ${n}")
        args.append(start)
        n += 1
        conditions.append(f"started_at < ${n}")
        args.append(end)
        n += 1
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    args.append(limit)
    rows = await db_fetch(
        f"""
        SELECT id, robot_id, trigger, started_at, ended_at, status,
               frame_count, storage_path, uploaded_at
        FROM sessions {where}
        ORDER BY started_at DESC LIMIT ${n}
        """,
        *args,
    )
    return [
        {
            "id": str(r["id"]),
            "robot_id": r["robot_id"],
            "trigger": r["trigger"],
            "started_at": r["started_at"].isoformat(),
            "ended_at": r["ended_at"].isoformat() if r["ended_at"] else None,
            "status": r["status"],
            "frame_count": r["frame_count"],
            "storage_path": r["storage_path"],
            "uploaded_at": r["uploaded_at"].isoformat(),
        }
        for r in rows
    ]


@app.get("/api/v1/sessions/{session_id}/captures", dependencies=[Depends(require_api_key)])
async def list_captures(
    session_id: str,
    modality: str = Query(default="all"),
):
    rows = await fetch_session_captures(session_id)
    captures = [capture_to_dict(r) for r in rows]
    return filter_by_modality(captures, modality)


@app.get("/api/v1/sessions/{session_id}/pairs", dependencies=[Depends(require_api_key)])
async def list_capture_pairs(session_id: str):
    rows = await fetch_session_captures(session_id)
    captures = [capture_to_dict(r) for r in rows]
    return build_capture_groups(captures)


@app.get("/api/v1/files/{storage_path:path}", dependencies=[Depends(require_api_key)])
async def serve_file(storage_path: str):
    rel = storage_path.strip("/")
    rel_path = Path(rel)
    if not rel or ".." in rel_path.parts:
        raise HTTPException(status_code=400, detail="invalid path")

    capture = await db_fetchrow(
        "SELECT deface_status FROM captures WHERE storage_path = $1",
        rel,
    )
    if capture is not None:
        status = capture["deface_status"]
        if status in ("pending", "processing"):
            raise HTTPException(
                status_code=425,
                detail="capture anonymization pending",
            )
        if status == "failed":
            raise HTTPException(
                status_code=424,
                detail="capture anonymization failed",
            )
    elif not await file_is_registered(rel):
        raise HTTPException(status_code=404, detail="file not found")

    full = resolve_storage_path(rel)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    return FileResponse(full, media_type=media_type_for_path(full))


REPLAY_DIR = Path(__file__).resolve().parent / "replay"
app.mount("/replay", StaticFiles(directory=REPLAY_DIR, html=True), name="replay")
