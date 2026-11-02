"""Tests for goal_publisher's single poll request and long-lived command writers."""
from pathlib import Path
import json
import sys
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

NOW = 1_000_000


def _goal_writer():
    from goal_publisher import GoalWriter
    from dds_utils import GraphqlPollBackoff

    gw = GoalWriter.__new__(GoalWriter)
    gw.my_id = 99
    gw.graphql_server = "http://example/graphql"
    gw._http = MagicMock()
    gw._poll_warn = GraphqlPollBackoff()
    gw.robot_goal_history = {}
    gw.robot_init_history = {}
    gw._mcu_block_logged = set()
    gw.participant = MagicMock()
    gw.publisher = MagicMock()
    gw.map_tf = None
    gw._topics = {}
    gw._target_data_writers = {}
    gw._command_data_writers = {}
    gw._last_multi_plan_key = None
    return gw


def _response(body):
    r = MagicMock()
    r.status_code = 200
    r.json.return_value = body
    return r


def _goal(robot_id, x, ts):
    return {"id": robot_id, "x_goal": x, "y_goal": 0.0, "theta_goal": 0.0,
            "goal_timestamp": ts, "goal_valid": True}


class _FakeDataWriter:
    created = []

    def __init__(self, publisher, topic, qos=None):
        self.qos = qos
        self.written = []
        _FakeDataWriter.created.append(self)

    def write(self, msg):
        self.written.append(msg)


def _patches(post):
    _FakeDataWriter.created = []
    return (
        patch("goal_publisher.post_graphql", post),
        patch("goal_publisher.DataWriter", _FakeDataWriter),
        patch("goal_publisher.Topic", MagicMock()),
    )


def test_poll_once_sends_one_request_on_shared_session():
    gw = _goal_writer()
    post = MagicMock(return_value=_response({"data": {}}))
    p1, p2, p3 = _patches(post)
    with p1, p2, p3:
        gw._poll_once(NOW)

    post.assert_called_once()
    assert post.call_args.kwargs["session"] is gw._http


def test_goals_reuse_writer_and_stop_uses_command_qos():
    from dds_utils import reliable_qos, reliable_transient_local_command_qos

    gw = _goal_writer()
    bodies = [
        {"data": {"robotGoals": [_goal(1, 1.0, NOW)]}},
        {"data": {"robotGoals": [_goal(1, 2.0, NOW + 1)],
                  "pendingRobotStops": [{"id": 1, "requested_at": NOW + 1}]}},
        {"data": {"consumeRobotStopRequest": True}},
    ]
    post = MagicMock(side_effect=[_response(b) for b in bodies])
    p1, p2, p3 = _patches(post)
    with p1, p2, p3, patch("goal_publisher.time.sleep"):
        gw._poll_once(NOW)
        gw._poll_once(NOW + 1)

    assert len(_FakeDataWriter.created) == 2
    goal_writer, stop_writer = _FakeDataWriter.created
    assert goal_writer.qos is reliable_qos
    assert [json.loads(m.data)["x"] for m in goal_writer.written] == [1.0, 2.0]
    assert stop_writer.qos is reliable_transient_local_command_qos
    assert [m.message_type for m in stop_writer.written] == ["stop"]


def test_partial_response_still_publishes_and_consumes_stop():
    gw = _goal_writer()
    poll = {
        "data": {"robotGoals": None, "pendingRobotStops": [{"id": 4, "requested_at": NOW}]},
        "errors": [{"message": "robotGoals failed", "path": ["robotGoals"]}],
    }
    post = MagicMock(side_effect=[_response(poll), _response({"data": {"consumeRobotStopRequest": True}})])
    p1, p2, p3 = _patches(post)
    with p1, p2, p3:
        gw._poll_once(NOW)

    assert [m.message_type for m in _FakeDataWriter.created[0].written] == ["stop"]
    assert post.call_args_list[1].kwargs["variables"] == {"robotId": 4}


def test_poll_failure_publishes_nothing():
    gw = _goal_writer()
    post = MagicMock(side_effect=RuntimeError("down"))
    p1, p2, p3 = _patches(post)
    with p1, p2, p3:
        gw._poll_once(NOW)

    assert _FakeDataWriter.created == []


def test_same_multi_robot_plan_is_written_once():
    gw = _goal_writer()
    plan = {"plan_id": "p1", "coordinated": True, "plan_timestamp": float(NOW),
            "goals": [{"robot_id": 1, "x_goal": 1.0, "y_goal": 2.0, "theta_goal": 0.0},
                      {"robot_id": 2, "x_goal": 3.0, "y_goal": 4.0, "theta_goal": 0.0}]}
    bodies = [
        {"data": {"activeMultiRobotGoalPlan": plan}},
        {"data": {"consumeMultiRobotGoalPlan": True}},
        {"data": {"activeMultiRobotGoalPlan": plan}},
    ]
    post = MagicMock(side_effect=[_response(b) for b in bodies])
    p1, p2, p3 = _patches(post)
    with p1, p2, p3, patch("goal_publisher.time.sleep"):
        gw._poll_once(NOW)
        gw._poll_once(NOW)

    assert post.call_count == 3
    assert [len(w.written) for w in _FakeDataWriter.created] == [1, 1]
