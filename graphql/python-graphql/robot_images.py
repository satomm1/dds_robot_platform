"""Latest JPEG frame storage (one file + JSON sidecar per robot)."""

import json
import os
from pathlib import Path

ROBOT_IMAGE_DIR = Path(os.environ.get("ROBOT_IMAGE_DIR", "/data/robot_images"))
PUBLIC_API_BASE = os.environ.get("PUBLIC_API_BASE", "http://localhost:8000").rstrip("/")


def ensure_image_dir():
    ROBOT_IMAGE_DIR.mkdir(parents=True, exist_ok=True)


def _paths(robot_id: int):
    rid = int(robot_id)
    return ROBOT_IMAGE_DIR / f"{rid}.jpg", ROBOT_IMAGE_DIR / f"{rid}.json"


def image_url(robot_id: int) -> str:
    return f"{PUBLIC_API_BASE}/robots/{int(robot_id)}/image/latest"


def read_meta(robot_id: int):
    _, meta_path = _paths(robot_id)
    if not meta_path.is_file():
        return None
    try:
        return json.loads(meta_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def has_image(robot_id: int) -> bool:
    jpg_path, _ = _paths(robot_id)
    return jpg_path.is_file()


def save_latest(robot_id: int, jpeg_bytes: bytes, *, timestamp, width, height):
    """Atomic write of JPEG + sidecar meta."""
    ensure_image_dir()
    jpg_path, meta_path = _paths(robot_id)
    tmp = jpg_path.with_suffix(".jpg.tmp")
    tmp.write_bytes(jpeg_bytes)
    os.replace(tmp, jpg_path)
    meta = {
        "robot_id": int(robot_id),
        "timestamp": float(timestamp) if timestamp is not None else None,
        "width": int(width) if width is not None else None,
        "height": int(height) if height is not None else None,
    }
    meta_tmp = meta_path.with_suffix(".json.tmp")
    meta_tmp.write_text(json.dumps(meta))
    os.replace(meta_tmp, meta_path)
    return meta


def load_jpeg(robot_id: int):
    jpg_path, _ = _paths(robot_id)
    if not jpg_path.is_file():
        return None, None
    return jpg_path.read_bytes(), read_meta(robot_id)
