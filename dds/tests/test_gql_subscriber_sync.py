"""Tests for GraphQL HTTP helpers used by DDS subscribers."""
from pathlib import Path
import sys
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dds_utils.gql_subscriber_sync import (  # noqa: E402
    TRANSFORM_FRESH_WAIT_S,
    TRANSFORM_REFRESH_S,
    MapTransformWatcher,
    fetch_map_transform_blocking,
    fetch_transform_Rt_blocking,
    parse_graphql_response,
)


def test_parse_graphql_response_success():
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = {"data": {"transform": {"R": [1, 0, 0, 1], "t": [0.0, 0.0]}}}
    data = parse_graphql_response(r)
    assert data["transform"]["R"] == [1, 0, 0, 1]


def test_parse_graphql_response_graphql_errors():
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = {"errors": [{"message": "Internal error"}]}
    with pytest.raises(RuntimeError, match="GraphQL errors"):
        parse_graphql_response(r)


def test_parse_graphql_response_bad_http():
    r = MagicMock()
    r.status_code = 502
    r.text = "<html>bad gateway</html>"
    with pytest.raises(RuntimeError, match="HTTP 502"):
        parse_graphql_response(r)


def test_fetch_transform_Rt_blocking_timeout():
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = {"data": {"transform": {"R": [0], "t": [0]}}}

    times = {"t": 0.0}

    def fake_time():
        return times["t"]

    def bump_sleep(_):
        times["t"] += 2.0

    with patch("dds_utils.gql_subscriber_sync.post_graphql", return_value=r):
        with patch("dds_utils.gql_subscriber_sync.time.time", fake_time):
            with patch("dds_utils.gql_subscriber_sync.time.sleep", bump_sleep):
                with pytest.raises(RuntimeError, match="Timed out"):
                    fetch_transform_Rt_blocking(
                        "http://127.0.0.1:9/graphql",
                        max_wait_s=5,
                        poll_s=0.01,
                    )


def test_fetch_map_transform_blocking_tps():
    src = [0.0, 0.0, 10.0, 0.0, 10.0, 10.0, 0.0, 10.0, 5.0, 4.0]
    dst = [1.0, 1.0, 11.2, 1.1, 11.0, 11.3, 0.9, 11.0, 6.1, 5.0]
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = {"data": {"transform": {
        "R": [1, 0, 0, 1], "t": [1.0, 1.0], "timestamp": 1,
        "model": "tps", "src_points": src, "dst_points": dst, "smooth": 0.0,
    }}}
    with patch("dds_utils.gql_subscriber_sync.post_graphql", return_value=r):
        tf = fetch_map_transform_blocking("http://127.0.0.1:9/graphql", max_wait_s=5)
        R, t = fetch_transform_Rt_blocking("http://127.0.0.1:9/graphql", max_wait_s=5)
    assert tf.model == "tps"
    assert abs(tf.apply((5.0, 4.0))[0] - 6.1) < 1e-9
    assert R.shape == (2, 2) and t.shape == (2,)


class FakeServer:
    """Fake clock + GraphQL transform store for MapTransformWatcher tests."""

    def __init__(self, now=1_000_000.0):
        self.now = now
        self.transform = {"R": [0], "t": [0], "s": 1.0, "timestamp": 0}

    def store(self, timestamp, R=(1, 0, 0, 1), t=(0.0, 0.0)):
        self.transform = {"R": list(R), "t": list(t), "timestamp": timestamp, "model": "rigid"}

    def post(self, *_args, **_kwargs):
        r = MagicMock()
        r.status_code = 200
        r.json.return_value = {"data": {"transform": dict(self.transform)}}
        return r

    def sleep(self, s):
        self.now += s

    def patches(self):
        mod = "dds_utils.gql_subscriber_sync"
        return (patch(f"{mod}.post_graphql", self.post),
                patch(f"{mod}.time.time", lambda: self.now),
                patch(f"{mod}.time.sleep", self.sleep))


def run_with(server, fn):
    p1, p2, p3 = server.patches()
    with p1, p2, p3:
        return fn()


def test_watcher_accepts_this_sessions_transform_immediately():
    srv = FakeServer()
    srv.store(timestamp=srv.now - 2)  # pushed just before we started
    w = run_with(srv, lambda: MapTransformWatcher("u", "test"))
    start = srv.now
    tf = run_with(srv, w.wait)
    assert tf.model == "rigid" and srv.now == start


def test_watcher_waits_for_entry_exit_instead_of_using_previous_session():
    srv = FakeServer()
    srv.store(timestamp=srv.now - 3600, t=(9.0, 9.0))  # left over from an earlier session
    w = run_with(srv, lambda: MapTransformWatcher("u", "test"))
    original_sleep = srv.sleep

    def sleep_then_push(s):
        original_sleep(s)
        if srv.now >= w.started_at + 5 and srv.transform["timestamp"] < w.started_at:
            srv.store(timestamp=srv.now, t=(1.0, 2.0))  # entry_exit pushes 5 s in

    srv.sleep = sleep_then_push
    tf = run_with(srv, w.wait)
    assert list(tf.t) == [1.0, 2.0]


def test_watcher_falls_back_to_stored_transform_after_grace_period():
    srv = FakeServer()
    srv.store(timestamp=srv.now - 3600, t=(9.0, 9.0))  # e.g. this script restarted on its own
    w = run_with(srv, lambda: MapTransformWatcher("u", "test"))
    tf = run_with(srv, w.wait)
    assert list(tf.t) == [9.0, 9.0]
    assert srv.now - w.started_at > TRANSFORM_FRESH_WAIT_S


def test_watcher_refresh_picks_up_newer_transform_only():
    srv = FakeServer()
    srv.store(timestamp=srv.now)
    w = run_with(srv, lambda: MapTransformWatcher("u", "test"))
    run_with(srv, w.wait)
    srv.now += TRANSFORM_REFRESH_S
    assert run_with(srv, w.refresh) is None  # unchanged
    srv.store(timestamp=srv.now, t=(3.0, 4.0))
    assert run_with(srv, w.refresh) is None  # rate-limited
    srv.now += TRANSFORM_REFRESH_S
    tf = run_with(srv, w.refresh)
    assert list(tf.t) == [3.0, 4.0] and w.map_tf is tf


def test_watcher_times_out_without_any_transform():
    srv = FakeServer()
    w = run_with(srv, lambda: MapTransformWatcher("u", "test"))
    with pytest.raises(RuntimeError, match="Timed out"):
        run_with(srv, lambda: w.wait(max_wait_s=30))
