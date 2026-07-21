"""Load global↔central common points and initialize Ignite global_transform on startup."""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

from ignite import ignite_client
from se2 import compute_similarity

logger = logging.getLogger(__name__)

GLOBAL_TRANSFORM_CACHE = "global_transform"
GLOBAL_TRANSFORM_KEY = 1
DEFAULT_COMMON_POINTS_FILENAME = "global_common_points.txt"

PointPair = Tuple[List[float], List[float]]  # (central_xy, global_xy)


def default_common_points_path() -> Path:
    override = os.environ.get("GLOBAL_COMMON_POINTS_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / DEFAULT_COMMON_POINTS_FILENAME


def load_common_point_pairs(path: Path) -> List[PointPair]:
    """Parse central_x,central_y,global_x,global_y lines (# comments and blanks ignored)."""
    if not path.is_file():
        raise FileNotFoundError(f"global common points file not found: {path}")

    pairs: List[PointPair] = []
    with path.open("r", encoding="utf-8") as fh:
        for line_no, raw in enumerate(fh, start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) != 4:
                raise ValueError(
                    f"{path}:{line_no}: expected central_x,central_y,global_x,global_y "
                    f"(got {len(parts)} fields)"
                )
            try:
                cx, cy, gx, gy = (float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3]))
            except ValueError as exc:
                raise ValueError(f"{path}:{line_no}: non-numeric values") from exc
            pairs.append(([cx, cy], [gx, gy]))
    return pairs


def get_global_transform_doc() -> Optional[dict]:
    cache = ignite_client.get_or_create_cache(GLOBAL_TRANSFORM_CACHE)
    raw = cache.get(GLOBAL_TRANSFORM_KEY)
    if raw is None:
        return None
    try:
        doc = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    R = doc.get("R")
    t = doc.get("t")
    if not isinstance(R, list) or not isinstance(t, list) or len(R) != 4 or len(t) != 2:
        return None
    if "s" not in doc or doc["s"] is None:
        doc = dict(doc)
        doc["s"] = 1.0
    else:
        try:
            doc["s"] = float(doc["s"])
        except (TypeError, ValueError):
            doc = dict(doc)
            doc["s"] = 1.0
        if doc["s"] <= 0:
            return None
    return doc


def require_global_transform() -> dict:
    doc = get_global_transform_doc()
    if doc is None:
        raise RuntimeError(
            "global_transform is not available; ensure global_common_points.txt "
            "exists with >=2 landmark pairs and restart the GraphQL server"
        )
    return doc


def init_global_transform_from_file(path: Optional[Path] = None) -> bool:
    """Compute similarity (scale + orthogonal + translation) global→central and store in Ignite.

    Returns True if a transform was written, False if skipped (missing/empty file).
    """
    points_path = path if path is not None else default_common_points_path()
    try:
        pairs = load_common_point_pairs(points_path)
    except FileNotFoundError:
        logger.warning(
            "global common points file missing (%s); global* APIs will be unavailable",
            points_path,
        )
        return False
    except ValueError as exc:
        logger.error("invalid global common points file: %s", exc)
        return False

    if len(pairs) < 2:
        logger.warning(
            "global common points file %s has %s pairs (need >=2); "
            "global* APIs will be unavailable",
            points_path,
            len(pairs),
        )
        return False

    central_points = [p[0] for p in pairs]
    global_points = [p[1] for p in pairs]
    try:
        # Stored R,t,s maps global → central (may include reflection, det≈-1)
        R_flat, t, s = compute_similarity(global_points, central_points)
    except ValueError as exc:
        logger.error("failed to compute global_transform: %s", exc)
        return False

    R_mat = np.asarray(R_flat, dtype=float).reshape(2, 2)
    det_R = float(np.linalg.det(R_mat))

    payload = {
        "R": R_flat,
        "t": t,
        "s": s,
        "timestamp": int(time.time()),
    }
    cache = ignite_client.get_or_create_cache(GLOBAL_TRANSFORM_CACHE)
    cache.put(GLOBAL_TRANSFORM_KEY, json.dumps(payload))
    logger.info(
        "Wrote global_transform to Ignite from %s (%s landmark pairs, s=%.6f, det(R)=%.6f%s)",
        points_path,
        len(pairs),
        s,
        det_R,
        "; reflection" if det_R < 0 else "",
    )
    return True
