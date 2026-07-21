#!/usr/bin/env python3
"""Sanity checks for mirrored / scaled global↔central similarity alignment."""

from __future__ import annotations

import math
import sys

import numpy as np

from se2 import compute_similarity, transform_pose


def _angle_close(a: float, b: float, tol: float = 1e-9) -> bool:
    return abs(math.atan2(math.sin(a - b), math.cos(a - b))) < tol


def _xflip_Rt():
    return compute_similarity(
        [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
        [[10.0, 0.0], [9.0, 0.0], [10.0, 1.0]],
    )


def test_x_flip_fit() -> None:
    W = 10.0
    global_pts = [[0.0, 0.0], [2.0, 0.0], [0.0, 3.0]]
    central_pts = [[W - 0.0, 0.0], [W - 2.0, 0.0], [W - 0.0, 3.0]]

    R_flat, t, s = compute_similarity(global_pts, central_pts)
    R = np.asarray(R_flat).reshape(2, 2)
    assert float(np.linalg.det(R)) < 0
    assert abs(s - 1.0) < 1e-9
    assert np.allclose(R, [[-1.0, 0.0], [0.0, 1.0]], atol=1e-9), R
    assert np.allclose(t, [W, 0.0], atol=1e-9), t

    for g, c in zip(global_pts, central_pts):
        cx, cy, _ = transform_pose(R_flat, t, g[0], g[1], 0.0, forward=True, s=s)
        assert abs(cx - c[0]) < 1e-9 and abs(cy - c[1]) < 1e-9


def test_scaled_x_flip_fit() -> None:
    W = 10.0
    S = 2.5
    global_pts = [[0.0, 0.0], [2.0, 0.0], [0.0, 3.0]]
    central_pts = [[S * (W - g[0]), S * g[1]] for g in global_pts]

    R_flat, t, s = compute_similarity(global_pts, central_pts)
    assert abs(s - S) < 1e-9
    for g, c in zip(global_pts, central_pts):
        cx, cy, _ = transform_pose(R_flat, t, g[0], g[1], 0.0, forward=True, s=s)
        assert abs(cx - c[0]) < 1e-9 and abs(cy - c[1]) < 1e-9

    for x, y, theta in ((1.5, 2.0, 0.3), (0.0, 0.0, math.pi / 2)):
        cx, cy, cth = transform_pose(R_flat, t, x, y, theta, forward=True, s=s)
        gx, gy, gth = transform_pose(R_flat, t, cx, cy, cth, forward=False, s=s)
        assert abs(gx - x) < 1e-9 and abs(gy - y) < 1e-9
        assert _angle_close(gth, theta)


def test_heading_roundtrip() -> None:
    R_flat, t, s = _xflip_Rt()
    for x, y, theta in (
        (1.5, 2.0, 0.0),
        (1.5, 2.0, math.pi / 2),
        (3.0, 0.5, -0.7),
        (0.0, 0.0, math.pi),
    ):
        cx, cy, cth = transform_pose(R_flat, t, x, y, theta, forward=True, s=s)
        gx, gy, gth = transform_pose(R_flat, t, cx, cy, cth, forward=False, s=s)
        assert abs(gx - x) < 1e-9 and abs(gy - y) < 1e-9
        assert _angle_close(gth, theta), (gth, theta)


def test_heading_conventions_xflip() -> None:
    """Global: 0=E, +π/2=S, π=W, −π/2=N. Central: 0=left, +π/2=down. R=X-flip."""
    R_flat, t, s = _xflip_Rt()

    # Global East (0) -> central right (π)
    _x, _y, cth = transform_pose(R_flat, t, 1.0, 1.0, 0.0, forward=True, s=s)
    assert _angle_close(cth, math.pi), cth

    # Global South (+π/2) -> central down (+π/2)
    _x, _y, cth = transform_pose(R_flat, t, 1.0, 1.0, math.pi / 2, forward=True, s=s)
    assert _angle_close(cth, math.pi / 2), cth

    # Global West (π) -> central left (0)
    _x, _y, cth = transform_pose(R_flat, t, 1.0, 1.0, math.pi, forward=True, s=s)
    assert _angle_close(cth, 0.0), cth

    # Global North (−π/2) -> central up (−π/2)
    _x, _y, cth = transform_pose(R_flat, t, 1.0, 1.0, -math.pi / 2, forward=True, s=s)
    assert _angle_close(cth, -math.pi / 2), cth

    cases = (
        (0.0, math.pi),               # left -> West
        (math.pi / 2, math.pi / 2),    # down -> South
        (math.pi, 0.0),               # right -> East
        (-math.pi / 2, -math.pi / 2),  # up -> North
    )
    for cth, expect_g in cases:
        _x, _y, gth = transform_pose(R_flat, t, 5.0, 5.0, cth, forward=False, s=s)
        assert _angle_close(gth, expect_g), (cth, gth, expect_g)


def test_proper_rotation_still_works() -> None:
    g = [[1.0, 0.0], [0.0, 1.0], [-1.0, 0.0]]
    c = [[0.0, 1.0], [-1.0, 0.0], [0.0, -1.0]]
    R_flat, t, s = compute_similarity(g, c)
    assert float(np.linalg.det(np.asarray(R_flat).reshape(2, 2))) > 0
    cx, cy, cth = transform_pose(R_flat, t, 1.0, 0.0, 0.0, forward=True, s=s)
    assert abs(cx) < 1e-9 and abs(cy - 1.0) < 1e-9
    assert _angle_close(cth, math.pi / 2)
    for th in (0.0, 0.4, math.pi / 2, -0.7):
        cx, cy, cth = transform_pose(R_flat, t, 1.0, 0.0, th, forward=True, s=s)
        gx, gy, gth = transform_pose(R_flat, t, cx, cy, cth, forward=False, s=s)
        assert abs(gx - 1.0) < 1e-9 and abs(gy) < 1e-9
        assert _angle_close(gth, th)


def main() -> int:
    test_x_flip_fit()
    test_scaled_x_flip_fit()
    test_heading_roundtrip()
    test_heading_conventions_xflip()
    test_proper_rotation_still_works()
    print("se2 similarity sanity checks OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
