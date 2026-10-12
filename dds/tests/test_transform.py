"""Unit tests for dds_utils/transform.py (known-point SE(2) estimation)."""

import os
import sys

import numpy as np
import pytest

# Import transform.py directly so the test doesn't need cyclonedds (pulled in by dds_utils/__init__).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "dds_utils"))
from transform import estimate_se2, load_known_points, transform_se2  # noqa: E402


def rot(theta):
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s], [s, c]])


def test_recovers_random_rigid_transform():
    rng = np.random.default_rng(0)
    pts = rng.uniform(0, 20, size=(4, 2))
    R_true, t_true = rot(0.7), np.array([3.0, -1.5])
    ref = pts @ R_true.T + t_true
    R, t = estimate_se2(pts.tolist(), ref.tolist())
    assert np.allclose(R, R_true)
    assert np.allclose(t, t_true)


def test_identical_points_give_identity():
    pts = [(3.45, 2.47), (7.69, 5.39), (7.59, 10.03)]
    R, t = estimate_se2(pts, [list(p) for p in pts])
    assert np.allclose(R, np.identity(2))
    assert np.allclose(t, 0)


def test_transform_se2_maps_points_onto_reference():
    pts = np.array([[3.45, 2.47], [7.69, 5.39], [7.59, 10.03]])
    ref = pts @ rot(-1.2).T + np.array([4.0, 2.0])
    R, t = estimate_se2(pts.tolist(), ref.tolist())
    for p, q in zip(pts, ref):
        out = transform_se2(R, t, (p[0], p[1], 0.0))
        assert np.allclose(out[:2], q)
        assert np.isclose(out[2], -1.2)
        back = transform_se2(R, t, out, forward=False)
        assert np.allclose(back[:2], p)


def test_rejects_bad_inputs():
    with pytest.raises(ValueError):
        estimate_se2([(0, 0), (1, 1)], [(0, 0)])
    with pytest.raises(ValueError):
        estimate_se2([(0, 0)], [(1, 1)])


def test_load_known_points_skips_blank_lines(tmp_path):
    f = tmp_path / "pts.txt"
    f.write_text("1.0,2.0\n\n3.5,4.5\n")
    assert load_known_points(str(f)) == [(1.0, 2.0), (3.5, 4.5)]


# --- MapTransform / TPS ---------------------------------------------------

from transform import (  # noqa: E402
    RigidMapTransform,
    TPS2D,
    TpsMapTransform,
    build_map_transform,
    map_transform_from_doc,
)

SRC = [(0.0, 0.0), (20.0, 0.0), (20.0, 15.0), (0.0, 15.0), (10.0, 7.0), (5.0, 12.0), (15.0, 3.0)]


def warped(points):
    """A smooth non-rigid field: rotation + translation + a gentle bend."""
    p = np.asarray(points, dtype=float)
    q = p @ rot(0.3).T + np.array([4.0, -2.0])
    q[:, 0] += 0.02 * p[:, 1] ** 2 / 15.0
    q[:, 1] += 0.4 * np.sin(p[:, 0] / 8.0)
    return [tuple(v) for v in q]


def test_tps_interpolates_control_points():
    dst = warped(SRC)
    tf = TpsMapTransform(SRC, dst)
    assert np.allclose(tf.apply_xy(SRC), dst, atol=1e-9)


def test_tps_on_rigid_data_matches_rigid_fit():
    R_true, t_true = rot(-0.8), np.array([2.0, 5.0])
    dst = (np.array(SRC) @ R_true.T + t_true).tolist()
    tf = TpsMapTransform(SRC, dst)
    assert np.allclose(tf.fwd.w, 0, atol=1e-9)
    probe = np.random.default_rng(1).uniform(-10, 30, (50, 2))
    assert np.allclose(tf.apply_xy(probe), probe @ R_true.T + t_true, atol=1e-6)
    assert np.allclose(tf.fwd.jacobian(probe), R_true, atol=1e-6)
    out = tf.apply((3.0, 4.0, 0.5))
    assert np.isclose(out[2], 0.5 - 0.8)


def test_tps_jacobian_matches_finite_difference():
    tps = TPS2D(SRC, warped(SRC))
    p = np.random.default_rng(2).uniform(-5, 25, (20, 2))
    e = 1e-6
    fd = np.stack([(tps(p + [e, 0]) - tps(p - [e, 0])) / (2 * e),
                   (tps(p + [0, e]) - tps(p - [0, e])) / (2 * e)], axis=-1)
    assert np.allclose(tps.jacobian(p), fd, atol=1e-5)


@pytest.mark.parametrize("pose", [(3.0, 4.0, 0.2), (19.0, 14.0, -2.9), (-8.0, 25.0, 1.5), (40.0, -10.0, 3.0)])
def test_tps_pose_round_trip(pose):
    tf = TpsMapTransform(SRC, warped(SRC))
    back = tf.apply(tf.apply(pose, forward=True), forward=False)
    assert np.allclose(back[:2], pose[:2], atol=1e-6)
    assert np.isclose(np.angle(np.exp(1j * (back[2] - pose[2]))), 0, atol=1e-6)


def test_tps_two_element_points_stay_two_elements():
    tf = TpsMapTransform(SRC, warped(SRC))
    assert tf.apply((1.0, 2.0)).shape == (2,)
    assert tf.apply((1.0, 2.0), forward=False).shape == (2,)


def test_build_map_transform_selection_and_fallback():
    dst = warped(SRC)
    assert build_map_transform(SRC, dst, "tps").model == "tps"
    assert build_map_transform(SRC, dst, "rigid").model == "rigid"
    few = build_map_transform(SRC[:3], dst[:3], "tps")
    assert few.model == "rigid" and "3 point pairs" in few.fallback_reason
    collinear = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)]
    bad = build_map_transform(collinear, warped(collinear), "tps")
    assert bad.model == "rigid" and bad.fallback_reason
    ident = build_map_transform(SRC, [list(p) for p in SRC], "tps")
    assert ident.model == "rigid" and ident.fallback_reason is None
    assert np.allclose(ident.apply((1.0, 2.0, 0.3)), (1.0, 2.0, 0.3))


def test_identity_rigid_apply_shapes():
    # estimate_se2 returns t with shape (2, 1) for identical points; apply must still give a pose.
    R, t = estimate_se2(SRC, SRC)
    out = RigidMapTransform(R, t).apply((1.0, 2.0, 0.5))
    assert out.shape == (3,)


def test_doc_round_trip_and_legacy_docs():
    tf = TpsMapTransform(SRC, warped(SRC), smooth=0.1)
    tf2 = map_transform_from_doc(tf.to_doc())
    probe = np.random.default_rng(3).uniform(-5, 25, (30, 2))
    assert tf2.model == "tps" and np.allclose(tf2.apply_xy(probe), tf.apply_xy(probe))

    rigid = map_transform_from_doc({"R": [0.0, -1.0, 1.0, 0.0], "t": [1.0, 2.0], "timestamp": 5})
    assert rigid.model == "rigid" and np.allclose(rigid.apply((1.0, 0.0)), (1.0, 3.0))
    assert map_transform_from_doc({"R": [0], "t": [0], "s": 1.0, "timestamp": 0}) is None
    assert map_transform_from_doc({}) is None
