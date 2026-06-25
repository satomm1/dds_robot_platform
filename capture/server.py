"""Central capture ingest service — upload from robots, query metadata, serve files."""

from __future__ import annotations

import hashlib
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "/data/captures")).resolve()
DATABASE_URL = os.environ["DATABASE_URL"]
API_KEYS = {k.strip() for k in os.environ.get("API_KEYS", "").split(",") if k.strip()}

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

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".wav"}

MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
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

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
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
) -> None:
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
                await conn.execute(
                    """
                    INSERT INTO captures (
                        session_id, robot_id, frame_id, filename, storage_path,
                        ros_time_sec, ros_time_nsec, wall_time,
                        pose_x, pose_y, pose_theta, detections, extra, sha256
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)
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
                    file_hashes.get(frame["filename"]),
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


def build_rgb_ir_pairs(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {f["frame_id"]: f for f in frames}
    pairs: list[dict[str, Any]] = []
    for frame in frames:
        if is_ir_frame(frame):
            continue
        ir = by_id.get(frame["frame_id"] + "_ir")
        if ir is None:
            ir = next(
                (
                    x for x in frames
                    if is_ir_frame(x)
                    and (x.get("extra") or {}).get("rgb_frame_id") == frame["frame_id"]
                ),
                None,
            )
        pairs.append({"rgb": frame, "ir": ir})
    return pairs


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
    }


def filter_by_modality(frames: list[dict[str, Any]], modality: str) -> list[dict[str, Any]]:
    if modality == "all":
        return frames
    if modality == "rgb":
        return [f for f in frames if not is_ir_frame(f)]
    if modality == "ir":
        return [f for f in frames if is_ir_frame(f)]
    raise HTTPException(status_code=400, detail="modality must be all, rgb, or ir")


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
               wall_time, pose_x, pose_y, pose_theta, detections, extra, sha256
        FROM captures WHERE session_id = $1::uuid
        ORDER BY wall_time NULLS LAST, ros_time_sec, ros_time_nsec
        """,
        session_id,
    )


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
    # Each manifest frame may be RGB, paired IR (*_ir.jpg), or wakeword WAV.
    for frame in normalized:
        data = uploaded[frame["filename"]]
        path = session_dir / frame["filename"]
        file_hashes[frame["filename"]] = write_bytes(path, data)

    write_bytes(session_dir / "manifest.json", manifest_bytes)
    await persist_session(parsed, session_rel, normalized, file_hashes)

    return {
        "ok": True,
        "session_id": parsed["session_id"],
        "files_accepted": len(normalized),
        "storage_path": session_rel,
    }


@app.get("/api/v1/robots", dependencies=[Depends(require_api_key)])
async def list_robots():
    rows = await db_fetch("SELECT id, name, created_at FROM robots ORDER BY id")
    return [
        {"id": r["id"], "name": r["name"], "created_at": r["created_at"].isoformat()}
        for r in rows
    ]


@app.get("/api/v1/sessions", dependencies=[Depends(require_api_key)])
async def list_sessions(
    robot_id: int | None = Query(default=None),
    trigger: str | None = Query(default=None),
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
    return build_rgb_ir_pairs(captures)


@app.get("/api/v1/files/{storage_path:path}", dependencies=[Depends(require_api_key)])
async def serve_file(storage_path: str):
    rel = storage_path.strip("/")
    rel_path = Path(rel)
    if not rel or ".." in rel_path.parts:
        raise HTTPException(status_code=400, detail="invalid path")

    if not await file_is_registered(rel):
        raise HTTPException(status_code=404, detail="file not found")

    full = resolve_storage_path(rel)
    if not full.is_file():
        raise HTTPException(status_code=404, detail="file not found")

    return FileResponse(full, media_type=media_type_for_path(full))
