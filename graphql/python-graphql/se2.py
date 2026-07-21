"""Similarity 2D alignment + pose transform for global↔central maps.

Supports uniform scale, proper rotations (det=+1), and reflections (det=-1).
This is separate from the DDS swarm SE(2) path, which stays rigid (no scale).
"""

from __future__ import annotations

from typing import List, Sequence, Tuple, Union

import numpy as np

Point2 = Sequence[float]
Pose3 = Tuple[float, float, float]
Similarity = Tuple[List[float], List[float], float]  # R_flat, t, s


def compute_similarity(
    from_points: Sequence[Point2],
    to_points: Sequence[Point2],
) -> Similarity:
    """Umeyama similarity: from_points -> to_points.

    Returns (R_flat, t, s) such that:
        p_to = s * R @ p_from + t

    R is orthogonal with det ±1 (reflections allowed). s > 0 is uniform scale.
    """
    if len(from_points) != len(to_points):
        raise ValueError(
            f"from_points and to_points must have equal length "
            f"(got {len(from_points)} vs {len(to_points)})"
        )
    if len(from_points) < 2:
        raise ValueError("need at least 2 corresponding points to compute similarity")

    src = np.asarray(from_points, dtype=float)
    dst = np.asarray(to_points, dtype=float)
    if src.shape != dst.shape or src.ndim != 2 or src.shape[1] != 2:
        raise ValueError("points must be Nx2 arrays")

    if np.allclose(src, dst):
        R = np.identity(2)
        t = np.zeros(2)
        return R.flatten().tolist(), t.tolist(), 1.0

    centroid_src = np.mean(src, axis=0)
    centroid_dst = np.mean(dst, axis=0)
    centered_src = src - centroid_src
    centered_dst = dst - centroid_dst

    var_src = float(np.sum(centered_src ** 2))
    if var_src < 1e-18:
        raise ValueError("source points have zero variance; cannot estimate scale")

    H = centered_src.T @ centered_dst
    U, _S, Vt = np.linalg.svd(H)
    R = Vt.T @ U.T
    # Keep det(R)=±1 as returned by SVD so mirrored frames (reflections) are allowed.

    # Umeyama scale: s = trace(centered_dst.T @ centered_src @ R.T) / ||centered_src||_F^2
    s = float(np.trace(centered_dst.T @ (centered_src @ R.T))) / var_src
    if s <= 0:
        raise ValueError(f"estimated scale must be positive (got s={s})")

    t = centroid_dst - s * R @ centroid_src
    return R.flatten().tolist(), np.asarray(t).reshape(-1).tolist(), float(s)


# Back-compat alias used by older call sites / tests during transition
def compute_se2(
    from_points: Sequence[Point2],
    to_points: Sequence[Point2],
) -> Similarity:
    return compute_similarity(from_points, to_points)


def _as_R_t(
    R: Union[np.ndarray, Sequence[float]],
    t: Union[np.ndarray, Sequence[float]],
) -> Tuple[np.ndarray, np.ndarray]:
    R_arr = np.asarray(R, dtype=float).reshape(2, 2)
    t_arr = np.asarray(t, dtype=float).reshape(2)
    return R_arr, t_arr


def _heading_to_map_dir(theta: float) -> np.ndarray:
    """Yaw → direction in a Y-down map frame (0=+X, +π/2=+Y).

    Used for both frames:
    - Central: 0=left (+X), +π/2=down (+Y)
    - Global:  0=East (+X), +π/2=South (+Y), −π/2=North (−Y)
    """
    return np.array([float(np.cos(theta)), float(np.sin(theta))], dtype=float)


def _map_dir_to_heading(v: np.ndarray) -> float:
    """Y-down map direction → yaw (0=+X, +π/2=+Y)."""
    return float(np.arctan2(v[1], v[0]))


def _transform_heading(R_arr: np.ndarray, theta: float, forward: bool) -> float:
    """Convert yaw between global and central map frames via R.

    Both frames use the same axis-aligned convention (0 along +X, CCW toward +Y).
    Only the axes differ (global +X east/right vs central +X left), which R captures.
    """
    v_in = _heading_to_map_dir(theta)
    v_out = R_arr @ v_in if forward else R_arr.T @ v_in
    return _map_dir_to_heading(v_out)


def transform_pose(
    R: Union[np.ndarray, Sequence[float]],
    t: Union[np.ndarray, Sequence[float]],
    x: float,
    y: float,
    theta: float,
    forward: bool = True,
    s: float = 1.0,
) -> Pose3:
    """Apply similarity map. Works for rotations, reflections, and uniform scale.

    forward=True:  p' = s * R @ p + t  (global → central)
    forward=False: p = (1/s) * R^T @ (p' - t)  (central → global)

    Heading (both frames, radians): 0 along +X, CCW toward +Y
    - Global:  0=East, +π/2=South, ±π=West, −π/2=North
    - Central: 0=left (+X), +π/2=down (+Y)
    """
    scale = float(s)
    if scale <= 0:
        raise ValueError(f"scale s must be positive (got {scale})")

    R_arr, t_arr = _as_R_t(R, t)
    point_xy = np.array([x, y], dtype=float)
    if forward:
        new_xy = scale * (R_arr @ point_xy) + t_arr
        new_theta = _transform_heading(R_arr, theta, forward=True)
    else:
        new_xy = (1.0 / scale) * (R_arr.T @ (point_xy - t_arr))
        new_theta = _transform_heading(R_arr, theta, forward=False)
    return float(new_xy[0]), float(new_xy[1]), float(new_theta)


def transform_pose_optional(
    R: Union[np.ndarray, Sequence[float], None],
    t: Union[np.ndarray, Sequence[float], None],
    x: float,
    y: float,
    theta: float,
    forward: bool = True,
    s: float = 1.0,
) -> Pose3:
    if R is None or t is None:
        return float(x), float(y), float(theta)
    return transform_pose(R, t, x, y, theta, forward=forward, s=s)
