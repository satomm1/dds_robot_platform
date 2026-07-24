"""Tests for position_init gating on Ignite-backed MCU state."""
from pathlib import Path
import sys
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def test_is_mcu_connected_queries_graphql():
    from goal_publisher import GoalWriter

    gw = GoalWriter.__new__(GoalWriter)
    gw.graphql_server = "http://example/graphql"

    with patch("goal_publisher.post_graphql") as post, patch(
        "goal_publisher.parse_graphql_response",
        return_value={"robotMcuState": {"mcu_connected": True}},
    ):
        assert gw._is_mcu_connected(42) is True

    post.assert_called_once()
    assert post.call_args.kwargs["variables"] == {"robotId": 42}


def test_is_mcu_connected_false_when_missing_or_error():
    from goal_publisher import GoalWriter

    gw = GoalWriter.__new__(GoalWriter)
    gw.graphql_server = "http://example/graphql"

    with patch("goal_publisher.post_graphql"), patch(
        "goal_publisher.parse_graphql_response",
        return_value={"robotMcuState": None},
    ):
        assert gw._is_mcu_connected(42) is False

    with patch("goal_publisher.post_graphql", side_effect=RuntimeError("down")):
        assert gw._is_mcu_connected(42) is False


def test_heartbeat_idl_has_mcu_connected_last():
    from dds_utils.messages import Heartbeat

    fields = list(Heartbeat.__dataclass_fields__)
    assert fields[-1] == "mcu_connected"
    assert "location_valid" in fields
    assert fields.index("location_valid") < fields.index("mcu_connected")


def test_entry_exit_heartbeat_listener_caches_mcu_fields():
    from entry_exit import EntryExitHeartbeatListener

    listener = EntryExitHeartbeatListener(my_id_int=1)
    sample = MagicMock()
    sample.agent_id = 42
    sample.timestamp = 1000
    sample.mcu_connected = True
    sample.location_valid = False
    reader = MagicMock()
    reader.read.return_value = [sample]

    listener.on_data_available(reader)
    hb = listener.get_heartbeats()
    assert hb[42] == {
        "timestamp": 1000,
        "mcu_connected": True,
        "location_valid": False,
    }
