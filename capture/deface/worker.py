"""Poll Postgres for pending RGB captures and anonymize faces with deface."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import tempfile
from pathlib import Path

import asyncpg
import imageio.v2 as imageio
from deface.centerface import CenterFace
from deface.deface import anonymize_frame

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("capture_deface")

DATABASE_URL = os.environ["DATABASE_URL"]
STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "/data/captures")).resolve()
POLL_INTERVAL_SEC = float(os.environ.get("DEFACE_POLL_INTERVAL_SEC", "1"))
BATCH_SIZE = int(os.environ.get("DEFACE_BATCH_SIZE", "8"))
# Parallel in-process detectors (each keeps its own ONNX session warm).
WORKERS = max(1, int(os.environ.get("DEFACE_WORKERS", "4")))
THRESHOLD = float(os.environ.get("DEFACE_THRESHOLD", "0.2"))
MASK_SCALE = float(os.environ.get("DEFACE_MASK_SCALE", "1.3"))
# Optional inference downscale, e.g. "320x240". Empty = full resolution.
_SCALE_RAW = os.environ.get("DEFACE_SCALE", "").strip()
IN_SHAPE: tuple[int, int] | None
if _SCALE_RAW:
    w_s, h_s = _SCALE_RAW.lower().split("x", 1)
    IN_SHAPE = (int(w_s), int(h_s))
else:
    IN_SHAPE = None
BACKEND = os.environ.get("DEFACE_BACKEND", "onnxrt")


def resolve_storage_path(rel_path: str) -> Path:
    rel = Path(rel_path)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"invalid storage path: {rel_path!r}")
    full = (STORAGE_ROOT / rel).resolve()
    full.relative_to(STORAGE_ROOT)
    return full


def raw_sibling(final: Path) -> Path:
    return final.with_name(f"{final.stem}.raw{final.suffix}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


class DetectorPool:
    """One CenterFace per worker so ONNX sessions stay warm and stay thread-isolated."""

    def __init__(self, size: int) -> None:
        self._queue: asyncio.Queue[CenterFace] = asyncio.Queue()
        self.size = size

    def start(self) -> None:
        log.info(
            "loading %d CenterFace model(s) backend=%s scale=%s",
            self.size,
            BACKEND,
            IN_SHAPE or "native",
        )
        for _ in range(self.size):
            model = CenterFace(in_shape=IN_SHAPE, backend=BACKEND)
            self._queue.put_nowait(model)
        log.info("models ready")

    async def deface_file(self, input_path: Path, output_path: Path) -> None:
        model = await self._queue.get()
        try:
            await asyncio.to_thread(self._run, model, input_path, output_path)
        finally:
            self._queue.put_nowait(model)

    @staticmethod
    def _run(model: CenterFace, input_path: Path, output_path: Path) -> None:
        frame = imageio.imread(str(input_path))
        dets, _ = model(frame, threshold=THRESHOLD)
        anonymize_frame(
            dets,
            frame,
            mask_scale=MASK_SCALE,
            replacewith="blur",
            ellipse=True,
            draw_scores=False,
            replaceimg=None,
            mosaicsize=20,
        )
        imageio.imsave(str(output_path), frame)
        if not output_path.is_file():
            raise RuntimeError(f"deface produced no output at {output_path}")


detector_pool: DetectorPool | None = None


async def ensure_schema(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        ALTER TABLE captures
          ADD COLUMN IF NOT EXISTS deface_status TEXT NOT NULL DEFAULT 'n/a',
          ADD COLUMN IF NOT EXISTS deface_error TEXT,
          ADD COLUMN IF NOT EXISTS defaced_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS sha256_original TEXT
        """
    )
    await conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_captures_deface_pending
          ON captures (id) WHERE deface_status = 'pending'
        """
    )


async def reset_stuck(conn: asyncpg.Connection) -> int:
    status = await conn.execute(
        """
        UPDATE captures
        SET deface_status = 'pending',
            deface_error = NULL
        WHERE deface_status = 'processing'
        """
    )
    count = int(status.split()[-1]) if status else 0
    if count:
        log.info("reset %d stuck processing row(s) to pending", count)
    return count


async def enqueue_archive_rgb(conn: asyncpg.Connection) -> int:
    status = await conn.execute(
        """
        UPDATE captures
        SET deface_status = 'pending'
        WHERE deface_status = 'n/a'
          AND filename ~* '\\.(jpe?g)$'
          AND coalesce(extra->>'modality', '') NOT IN ('ir', 'depth')
          AND filename NOT LIKE '%_ir.jpg'
          AND filename NOT LIKE '%_depth.png'
        """
    )
    count = int(status.split()[-1]) if status else 0
    if count:
        log.info("enqueued %d existing RGB archive row(s)", count)
    return count


async def claim_pending(conn: asyncpg.Connection, limit: int) -> list[asyncpg.Record]:
    return await conn.fetch(
        """
        UPDATE captures
        SET deface_status = 'processing'
        WHERE id IN (
            SELECT id
            FROM captures
            WHERE deface_status = 'pending'
            ORDER BY id DESC
            FOR UPDATE SKIP LOCKED
            LIMIT $1
        )
        RETURNING id, storage_path, filename
        """,
        limit,
    )


async def mark_done(conn: asyncpg.Connection, capture_id: int, digest: str) -> None:
    await conn.execute(
        """
        UPDATE captures
        SET deface_status = 'done',
            deface_error = NULL,
            defaced_at = now(),
            sha256 = $2
        WHERE id = $1
        """,
        capture_id,
        digest,
    )


async def mark_failed(conn: asyncpg.Connection, capture_id: int, error: str) -> None:
    await conn.execute(
        """
        UPDATE captures
        SET deface_status = 'failed',
            deface_error = $2
        WHERE id = $1
        """,
        capture_id,
        error[:4000],
    )


async def process_one(pool: asyncpg.Pool, row: asyncpg.Record) -> None:
    assert detector_pool is not None
    capture_id = row["id"]
    rel = row["storage_path"]
    try:
        final = resolve_storage_path(rel)
    except ValueError as exc:
        async with pool.acquire() as conn:
            await mark_failed(conn, capture_id, str(exc))
        log.error("id=%s invalid path: %s", capture_id, exc)
        return

    raw = raw_sibling(final)
    if raw.is_file():
        input_path = raw
    elif final.is_file():
        input_path = final
    else:
        msg = f"missing input: neither {raw.name} nor {final.name} in {final.parent}"
        async with pool.acquire() as conn:
            await mark_failed(conn, capture_id, msg)
        log.error("id=%s %s", capture_id, msg)
        return

    tmp_path: Path | None = None
    try:
        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{final.stem}.deface.",
            suffix=final.suffix,
            dir=final.parent,
        )
        os.close(fd)
        tmp_path = Path(tmp_name)
        await detector_pool.deface_file(input_path, tmp_path)
        digest = await asyncio.to_thread(sha256_file, tmp_path)
        # mkstemp defaults to 0o600; match ingest world-readable captures for host/Explorer access
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, final)
        tmp_path = None
        if raw.is_file():
            raw.unlink()
        async with pool.acquire() as conn:
            await mark_done(conn, capture_id, digest)
        log.info("id=%s done (%s)", capture_id, rel)
    except Exception as exc:
        if tmp_path is not None and tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        async with pool.acquire() as conn:
            await mark_failed(conn, capture_id, str(exc))
        log.exception("id=%s failed: %s", capture_id, exc)


async def poll_once(pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await claim_pending(conn, BATCH_SIZE)
    if not rows:
        return 0
    await asyncio.gather(*(process_one(pool, row) for row in rows))
    return len(rows)


async def main() -> None:
    global detector_pool
    log.info(
        "starting capture_deface storage_root=%s poll=%.1fs batch=%d workers=%d",
        STORAGE_ROOT,
        POLL_INTERVAL_SEC,
        BATCH_SIZE,
        WORKERS,
    )
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    detector_pool = DetectorPool(WORKERS)
    detector_pool.start()
    db_pool = await asyncpg.create_pool(
        DATABASE_URL, min_size=1, max_size=max(4, WORKERS + 2)
    )
    try:
        async with db_pool.acquire() as conn:
            await ensure_schema(conn)
            await reset_stuck(conn)
            await enqueue_archive_rgb(conn)
        while True:
            try:
                n = await poll_once(db_pool)
            except Exception:
                log.exception("poll cycle failed")
                n = 0
            if n == 0:
                await asyncio.sleep(POLL_INTERVAL_SEC)
    finally:
        await db_pool.close()


if __name__ == "__main__":
    asyncio.run(main())
