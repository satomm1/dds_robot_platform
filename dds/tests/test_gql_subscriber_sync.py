"""Tests for GraphQL HTTP helpers used by DDS subscribers."""
from pathlib import Path
import sys
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dds_utils.gql_subscriber_sync import (  # noqa: E402
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
