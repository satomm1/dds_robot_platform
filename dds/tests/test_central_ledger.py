"""Tests for the central ledger mirror (observation_ledger.py); no DDS traffic needed."""
from dataclasses import fields
import json
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dds_utils.ledger import GatedResolver, Observation, ObservationLedger, Removal, make_obs_id  # noqa: E402
from dds_utils.message_types import (  # noqa: E402
    MSG_LEDGER_OBSERVATION,
    MSG_LEDGER_REMOVAL,
    MSG_LEDGER_SYNC_REQUEST,
    MSG_LEDGER_SYNC_RESPONSE,
)
from observation_ledger import (  # noqa: E402
    MATCH_RADIUS_M,
    CentralLedger,
    add_remote,
    apply_sync_response,
    build_sync_response,
    snapshot,
)

CENTRAL = 101


def at(observer, seq, x, y, stamp, cls="chair", object_id=None, session=100, width=0.5):
    oid = make_obs_id(observer, session, seq)
    return Observation(oid, object_id or oid, observer, session, seq, stamp, cls, 0.9, width, x, y)


def removal(observer, seq, object_id, stamp, x=1.0, y=1.0, cls="chair", session=100):
    return Removal(make_obs_id(observer, session, seq), object_id, observer, session, seq, stamp, cls, x, y)


def populated_ledger():
    """Several agents and sessions, a merged object, and a removed object."""
    ledger = ObservationLedger()
    resolver = GatedResolver(MATCH_RADIUS_M)
    chair_a = at(3, 1, 1.0, 1.0, stamp=1.0)
    chair_b = at(6, 1, 1.2, 1.0, stamp=2.0)  # own id; merged by reconcile
    cone = at(6, 2, 5.0, 5.0, stamp=3.0, cls="cone")
    gone = at(3, 2, 9.0, 9.0, stamp=4.0, cls="box")
    later = at(3, 1, 2.0, 7.0, stamp=50.0, session=200)  # robot 3 restarted
    for o in (chair_a, chair_b, cone, gone, later):
        if ledger.add(o):
            add_remote(ledger, resolver, o)
    ledger.remove(removal(6, 3, gone.obs_id, stamp=10.0, x=9.0, y=9.0, cls="box"))
    return ledger


def obs_ids(ledger):
    return {o.obs_id for _, g in ledger.query() for o in g}


def grouping(ledger):
    return {k: sorted(o.obs_id for o in v) for k, v in ledger.objects().items()}


def test_sync_response_round_trip():
    original = populated_ledger()
    resp = json.loads(json.dumps(build_sync_response(original, CENTRAL, None)))

    assert resp["responder"] == CENTRAL
    assert "seq_high" not in resp  # passive central
    obs_keys = {f.name for f in fields(Observation)}
    rem_keys = {f.name for f in fields(Removal)}
    assert all(set(d) == obs_keys for d in resp["observations"])  # robots do Observation(**d)
    assert all(set(d) == rem_keys for d in resp["removals"])

    rebuilt = ObservationLedger()
    apply_sync_response(rebuilt, GatedResolver(MATCH_RADIUS_M), resp)
    assert obs_ids(rebuilt) == obs_ids(original)
    assert grouping(rebuilt) == grouping(original)
    assert rebuilt.removals() == original.removals()


def test_sync_response_filters_by_agents():
    resp = build_sync_response(populated_ledger(), CENTRAL, [3])
    assert {d["observer_id"] for d in resp["observations"]} == {3}
    assert resp["removals"] == []  # the removal was made by agent 6


def test_removals_applied_before_observations():
    # Agent 7 saw the chair (own new object id) before agent 9 removed it.
    seen = at(3, 1, 1.0, 1.0, stamp=1.0)
    stale = at(7, 1, 1.2, 1.0, stamp=5.0)
    rem = removal(9, 1, seen.obs_id, stamp=10.0)
    resp = {
        "responder": 9,
        "observations": [seen.to_dict(), stale.to_dict()],
        "removals": [rem.to_dict()],
    }

    ledger = ObservationLedger()
    apply_sync_response(ledger, GatedResolver(MATCH_RADIUS_M), resp)
    assert ledger.objects() == {}
    assert ledger.is_removed(seen.obs_id)
    assert ledger.is_removed(stale.obs_id)  # absorbed as a stale sighting


def test_observations_before_removal_without_absorb_keep_stale_object():
    # Control for the ordering above: observations first and plain add() leaves the stale one.
    seen = at(3, 1, 1.0, 1.0, stamp=1.0)
    stale = at(7, 1, 1.2, 1.0, stamp=5.0)
    ledger = ObservationLedger()
    ledger.add(seen)
    ledger.add(stale)
    ledger.remove(removal(9, 1, seen.obs_id, stamp=10.0))
    assert list(ledger.objects()) == [stale.obs_id]


def test_apply_sync_response_marks_seq_high_complete():
    ledger = ObservationLedger()
    resp = {"responder": 6, "observations": [at(6, 5, 1.0, 1.0, stamp=1.0).to_dict()], "removals": [],
            "seq_high": {"100": 5}}
    apply_sync_response(ledger, GatedResolver(), resp)
    assert ledger.missing_seq(6, 100) == []


def test_snapshot_fields_and_belief():
    ledger = ObservationLedger()
    a = at(3, 1, 1.0, 1.0, stamp=100.0, width=0.4)
    b = at(6, 1, 2.0, 3.0, stamp=110.0, cls="chair2", object_id=a.obs_id, width=0.9)
    ledger.add(a)
    ledger.add(b)

    (obj,) = snapshot(ledger, now=140.0)
    assert obj["id"] == a.obs_id
    assert (obj["x"], obj["y"]) == (1.5, 2.0)
    assert obj["class_name"] == "chair2"  # latest
    assert obj["width"] == 0.9
    assert obj["observers"] == [3, 6] and obj["n_obs"] == 2
    assert obj["belief"] == 1.0  # age 30 s
    assert snapshot(ledger, now=230.0)[0]["belief"] == 0.5  # age 120 s
    assert snapshot(ledger, now=310.0)[0]["belief"] == 0.0  # age 200 s


def test_snapshot_applies_central_transform():
    ledger = ObservationLedger()
    ledger.add(at(3, 1, 1.0, 2.0, stamp=0.0))
    R = np.eye(2)
    t = np.array([1.0, 1.0])
    (obj,) = snapshot(ledger, now=0.0, R=R, t=t)
    assert (obj["x"], obj["y"]) == (0.0, 1.0)  # R.T @ (p - t)


# ---------- Message handling ----------


class Sent:
    def __init__(self):
        self.messages = []

    def __call__(self, topic_id, message_type, payload):
        self.messages.append((topic_id, message_type, json.loads(json.dumps(payload))))


def make_core(now=1000.0):
    sent = Sent()
    clock = [now]
    core = CentralLedger(CENTRAL, sent, clock=lambda: clock[0])
    return core, sent, clock


def test_only_samples_from_topic_owner_are_processed():
    core, _, _ = make_core()
    o = at(3, 1, 1.0, 1.0, stamp=1.0)
    core.handle_robot_sample(6, 3, MSG_LEDGER_OBSERVATION, json.dumps(o.to_dict()))  # directed to 6
    assert core.ledger.objects() == {}
    core.handle_robot_sample(3, 3, MSG_LEDGER_OBSERVATION, json.dumps(o.to_dict()))
    assert list(core.ledger.objects()) == [o.obs_id]


def test_own_topic_ignores_own_samples_and_other_types():
    core, _, _ = make_core()
    resp = json.dumps({"responder": 3, "observations": [at(3, 1, 1.0, 1.0, stamp=1.0).to_dict()],
                       "removals": []})
    core.handle_own_sample(CENTRAL, MSG_LEDGER_SYNC_RESPONSE, resp)
    core.handle_own_sample(3, MSG_LEDGER_OBSERVATION, resp)
    assert core.ledger.objects() == {}
    core.handle_own_sample(3, MSG_LEDGER_SYNC_RESPONSE, resp)
    assert len(core.ledger.objects()) == 1
    assert 3 in core.synced


def test_removal_sample_removes_object():
    core, _, _ = make_core()
    o = at(3, 1, 1.0, 1.0, stamp=1.0)
    core.handle_robot_sample(3, 3, MSG_LEDGER_OBSERVATION, json.dumps(o.to_dict()))
    core.handle_robot_sample(6, 6, MSG_LEDGER_REMOVAL, json.dumps(removal(6, 1, o.obs_id, 5.0).to_dict()))
    assert core.ledger.objects() == {}


def test_gap_triggers_throttled_sync_request():
    core, sent, clock = make_core()
    core.on_observation(at(3, 1, 1.0, 1.0, stamp=1.0))
    assert sent.messages == []
    core.on_observation(at(3, 3, 5.0, 5.0, stamp=2.0))  # seq 2 dropped
    assert sent.messages == [
        (CENTRAL, MSG_LEDGER_SYNC_REQUEST, {"requester": CENTRAL, "responders": [3], "agents": [3]})
    ]
    core.on_observation(at(3, 5, 9.0, 9.0, stamp=3.0))  # within 5 s: throttled
    assert len(sent.messages) == 1
    clock[0] += 6.0
    core.on_observation(at(3, 6, 12.0, 9.0, stamp=4.0))
    assert len(sent.messages) == 2


def test_answers_sync_request_only_when_listed():
    core, sent, _ = make_core()
    o = at(3, 1, 1.0, 1.0, stamp=1.0)
    core.on_observation(o)
    req = {"requester": 6, "responders": [3], "agents": None}
    core.handle_robot_sample(6, 6, MSG_LEDGER_SYNC_REQUEST, json.dumps(req))
    assert sent.messages == []
    req["responders"] = [3, CENTRAL]
    core.handle_robot_sample(6, 6, MSG_LEDGER_SYNC_REQUEST, json.dumps(req))
    ((topic, mtype, payload),) = sent.messages
    assert (topic, mtype) == (6, MSG_LEDGER_SYNC_RESPONSE)
    assert payload == {"responder": CENTRAL, "observations": [o.to_dict()], "removals": []}


def test_startup_sync_retries_and_resyncs_on_rejoin():
    core, sent, _ = make_core()
    core.set_robots({3, 6})
    assert core.sync_tick() == [3, 6]
    assert sent.messages[-1] == (
        CENTRAL, MSG_LEDGER_SYNC_REQUEST, {"requester": CENTRAL, "responders": [3, 6], "agents": None}
    )
    core.on_sync_response({"responder": 3, "observations": [], "removals": []})
    for _ in range(4):
        assert core.sync_tick() == [6]
    assert core.sync_tick() == []  # 5 attempts used for robot 6

    o = at(3, 1, 1.0, 1.0, stamp=1.0)
    core.on_observation(o)
    core.set_robots({6})  # robot 3 leaves: forget sync state, keep its observations
    assert list(core.ledger.objects()) == [o.obs_id]
    core.set_robots({3, 6})
    assert core.sync_tick() == [3]
