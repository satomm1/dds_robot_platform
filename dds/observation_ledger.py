"""Central (non-robot) mirror of the fleet observation ledger.

Mirrors the robots' shared ledger (dds_utils/ledger.py, vendored from mattbot_dds) and answers
ledger sync requests so a restarted robot can recover the ledger from the central. Peer, removal
and sync handling follow mattbot_dds scripts/observation_ledger.py.

The central is passive: it never creates observations or removals, so it has no session/seq of
its own and never sends seq_high. Objects are published to GraphQL (setLedgerObjects).

Merge decisions and absorb_stale compare stamps across machines: keep this host NTP-synced with
the robots.
"""

import json
import queue
import signal
import sys
import threading
import time

from cyclonedds.core import Policy, Qos
from cyclonedds.internal import InvalidSample
from cyclonedds.pub import DataWriter, Publisher
from cyclonedds.sub import DataReader, Subscriber
from cyclonedds.topic import Topic
from cyclonedds.util import duration

from dds_utils import (
    AgentIdError,
    DataMessage,
    GraphqlPollBackoff,
    create_domain_participant,
    dds_log,
    dds_warn,
    dispose_entity,
    dispose_participant,
    fetch_subscribed_agent_ids_set,
    MapTransformWatcher,
    get_ip,
    parse_graphql_response,
    post_graphql,
    reliable_qos,
    reliable_transient_local_command_qos,
    require_agent_id_int,
)
from dds_utils.belief import BELIEF_T1_S, BELIEF_T2_S, object_belief
from dds_utils.config import resolve_graphql_http_url
from dds_utils.ledger import GatedResolver, Observation, ObservationLedger, Removal
from dds_utils.message_types import (
    MSG_LEDGER_OBSERVATION,
    MSG_LEDGER_REMOVAL,
    MSG_LEDGER_SYNC_REQUEST,
    MSG_LEDGER_SYNC_RESPONSE,
)
from dds_utils.topics import data_topic_name

COMPONENT = "ledger"

MATCH_RADIUS_M = 0.75  # robot default; must match or the central merges objects differently
SYNC_PERIOD_S = 3.0
SYNC_MAX_ATTEMPTS = 5  # per robot
GAP_REQUEST_PERIOD_S = 5.0  # per agent
DISCOVERY_GRACE_S = 3.0
CLOCK_SKEW_WARN_S = 2.0
PUBLISH_PERIOD_S = 1.0  # when the ledger changed
REFRESH_PERIOD_S = 5.0  # unconditionally, so beliefs decay in the GUI
IO_POLL_PERIOD_S = 0.005

# Readers keep more than the writers' KeepLast(1) so samples arriving between polls are not
# overwritten. History is not a matching policy, so this still matches the robots' writers.
ledger_reader_qos = Qos(
    Policy.Reliability.Reliable(max_blocking_time=duration(milliseconds=10)),
    Policy.Durability.TransientLocal,
    Policy.History.KeepLast(depth=64),
)

SET_LEDGER_OBJECTS_MUTATION = """
mutation SetLedgerObjects($objects: String!) {
    setLedgerObjects(objects: $objects)
}
"""


# ---------- Pure helpers (no DDS; unit-tested) ----------


def add_remote(ledger, resolver, obs):
    """Merge a newly added remote observation (same as the robots)."""
    if ledger.absorb_stale(obs, resolver.radius_m):
        return  # stale sighting of an already-removed object
    ledger.reconcile(obs, resolver)


def build_sync_response(ledger, responder, agents):
    """Payload answering a sync request for `agents` (None/empty = all). Passive: no seq_high."""
    return {
        "responder": responder,
        "observations": [o.to_dict() for _, group in ledger.query(agent_ids=agents) for o in group],
        "removals": [r.to_dict() for r in ledger.removals(agent_ids=agents)],
    }


def apply_sync_response(ledger, resolver, resp):
    """Apply a sync response: removals first, then observations, then seq_high. Returns #added."""
    for d in resp.get("removals", []):
        ledger.remove(Removal.from_dict(d))
    added = 0
    for d in resp.get("observations", []):
        obs = Observation.from_dict(d)
        if ledger.add(obs):
            added += 1
            add_remote(ledger, resolver, obs)
    for session, max_seq in (resp.get("seq_high") or {}).items():
        ledger.mark_complete(int(resp["responder"]), int(session), int(max_seq))
    return added


def snapshot(ledger, now, map_tf=None):
    """Current objects for display. x, y are the mean position, mapped to the central frame with map_tf."""
    result = []
    for object_id, members in ledger.objects().items():
        n = len(members)
        x = sum(o.x for o in members) / n
        y = sum(o.y for o in members) / n
        if map_tf is not None:
            x, y = map_tf.apply((x, y), forward=False)
        last_seen = max(o.stamp for o in members)
        result.append({
            "id": object_id,
            "class_name": members[-1].class_name,  # members are oldest first
            "x": float(x),
            "y": float(y),
            "width": max(o.width for o in members),
            "last_seen": last_seen,
            "belief": object_belief(now - last_seen, BELIEF_T1_S, BELIEF_T2_S),
            "observers": sorted({o.observer_id for o in members}),
            "n_obs": n,
        })
    return result


class CentralLedger:
    """Ledger state and message handling, independent of DDS.

    `send(topic_agent_id, message_type, payload)` writes a DataMessage to DataTopic{topic_agent_id}.
    """

    def __init__(self, central_id, send, clock=time.time):
        self.central_id = central_id
        self.send = send
        self.clock = clock
        self.start_time = clock()
        self.lock = threading.Lock()
        self.ledger = ObservationLedger()
        self.resolver = GatedResolver(MATCH_RADIUS_M)
        self.robots = set()
        self.synced = set()
        self.sync_attempts = {}
        self.last_gap_request = {}
        self.dirty = True
        self._last_skew_warn = 0.0

    # ---------- Fleet ----------

    def set_robots(self, robots):
        with self.lock:
            for gone in self.robots - robots:
                # Forget sync state so a rejoining robot is re-synced. Never purge its observations.
                self.synced.discard(gone)
                self.sync_attempts.pop(gone, None)
            self.robots = set(robots)

    # ---------- Incoming samples ----------

    def handle_robot_sample(self, topic_id, sending_agent, message_type, data, timestamp=None):
        """A sample read from DataTopic{topic_id}."""
        if sending_agent != topic_id:
            return  # directed message from another agent to topic_id
        if message_type == MSG_LEDGER_OBSERVATION:
            self.on_observation(Observation.from_dict(json.loads(data)))
        elif message_type == MSG_LEDGER_REMOVAL:
            self.on_removal(Removal.from_dict(json.loads(data)))
        elif message_type == MSG_LEDGER_SYNC_REQUEST:
            self.on_sync_request(json.loads(data))

    def handle_own_sample(self, sending_agent, message_type, data, timestamp=None):
        """A sample read from DataTopic{central_id}."""
        if sending_agent == self.central_id or message_type != MSG_LEDGER_SYNC_RESPONSE:
            return
        if timestamp is not None and timestamp < int(self.start_time) - 1:
            # TransientLocal replay of a response to a previous run of this node; robots keep
            # their last response per target. Accepting it would mark the robot synced with
            # stale data and skip the fresh startup sync.
            dds_log(COMPONENT, f"ignoring stale sync response from {sending_agent} (sent {timestamp})")
            return
        self.on_sync_response(json.loads(data))

    def on_observation(self, obs):
        self._check_clock(obs.stamp, obs.observer_id)
        with self.lock:
            if self.ledger.add(obs):
                add_remote(self.ledger, self.resolver, obs)
                self.dirty = True
            gap = self._check_gap(obs.observer_id, obs.session)
        if gap:
            self._request_gap(obs.observer_id, gap)

    def on_removal(self, removal):
        with self.lock:
            if self.ledger.remove(removal):
                self.dirty = True
            gap = self._check_gap(removal.observer_id, removal.session)
        if gap:
            self._request_gap(removal.observer_id, gap)

    def on_sync_request(self, req):
        if self.central_id not in req.get("responders", []):
            return
        agents = req.get("agents")
        with self.lock:
            payload = build_sync_response(self.ledger, self.central_id, agents)
        self.send(int(req["requester"]), MSG_LEDGER_SYNC_RESPONSE, payload)
        dds_log(
            COMPONENT,
            f"sync response to {req['requester']}: {len(payload['observations'])} obs, "
            f"{len(payload['removals'])} removals (agents={agents})",
        )

    def on_sync_response(self, resp):
        responder = int(resp["responder"])
        with self.lock:
            added = apply_sync_response(self.ledger, self.resolver, resp)
            self.synced.add(responder)
            self.dirty = True
        dds_log(COMPONENT, f"sync response from {responder}: {added} new obs")

    # ---------- Gaps and startup sync ----------

    def _check_gap(self, agent_id, session):  # lock held
        gap = self.ledger.missing_seq(agent_id, session)
        now = self.clock()
        if not gap or now - self.last_gap_request.get(agent_id, 0.0) <= GAP_REQUEST_PERIOD_S:
            return []
        self.last_gap_request[agent_id] = now
        return gap

    def _request_gap(self, agent_id, gap):
        dds_log(COMPONENT, f"missing seq {gap} from agent {agent_id}; requesting sync")
        self.send_sync_request(responders=[agent_id], agents=[agent_id])

    def send_sync_request(self, responders, agents):
        payload = {"requester": self.central_id, "responders": list(responders), "agents": agents}
        self.send(self.central_id, MSG_LEDGER_SYNC_REQUEST, payload)

    def sync_tick(self):
        """Broadcast a startup sync request to robots not yet synced (bounded retries)."""
        with self.lock:
            pending = sorted(
                r for r in self.robots - self.synced
                if self.sync_attempts.get(r, 0) < SYNC_MAX_ATTEMPTS
            )
            for r in pending:
                self.sync_attempts[r] = self.sync_attempts.get(r, 0) + 1
        if pending:
            self.send_sync_request(responders=pending, agents=None)
        return pending

    # ---------- Exposure ----------

    def take_snapshot(self, map_tf=None):
        with self.lock:
            self.dirty = False
            return snapshot(self.ledger, self.clock(), map_tf)

    def _check_clock(self, stamp, observer_id):
        now = self.clock()
        if stamp - now > CLOCK_SKEW_WARN_S and now - self._last_skew_warn > 60.0:
            self._last_skew_warn = now
            dds_warn(
                COMPONENT,
                f"observation from {observer_id} is {stamp - now:.1f}s in the future; check NTP sync",
            )


# ---------- DDS node ----------


def _dispatch(reader, handler, label):
    """Take every pending sample from reader and hand it to handler."""
    while True:
        samples = reader.take(N=64)
        if not samples:
            return
        for sample in samples:
            if isinstance(sample, InvalidSample):
                continue
            try:
                handler(int(sample.sending_agent), sample.message_type, sample.data, int(sample.timestamp))
            except Exception as exc:  # a bad sample must never stop the I/O loop
                dds_warn(COMPONENT, f"bad {sample.message_type} sample on {label}: {exc!r}")


class CentralLedgerNode:
    """DDS side. No listeners: a single I/O thread polls the readers and does every write.

    Python listener callbacks run on Cyclone's receive threads and need the GIL; a write from a
    Python thread to a topic this participant also reads with a listener deadlocked against them
    (the writer thread hung in write() and the node stopped answering sync requests).
    """

    def __init__(self, central_id, server_url=None):
        if not -32768 <= central_id <= 32767:
            raise ValueError(f"AGENT_ID {central_id} does not fit in an int16 (robot peer lists)")
        self.central_id = central_id
        self.graphql_server = resolve_graphql_http_url(my_ip=get_ip(), server_url=server_url)
        self._graphql_warn = GraphqlPollBackoff()
        self.core = CentralLedger(central_id, self._send)
        self.map_tf = None
        self._tf_watch = MapTransformWatcher(self.graphql_server, COMPONENT)
        self.running = True

        self.participant = create_domain_participant(domain_qos=False)
        self.subscriber = Subscriber(self.participant)
        self.publisher = Publisher(self.participant)
        self._topics = {}
        self._topics_lock = threading.Lock()  # fleet poll (main) and sender threads
        self._writers = {}  # only touched by the I/O thread
        self._outbox = queue.Queue()
        self._readers_lock = threading.Lock()  # fleet poll (main) and I/O threads
        self.robot_readers = {}  # robot id -> (reader, handler, label)

        label = data_topic_name(central_id)
        own_reader = DataReader(self.subscriber, self._topic(central_id), qos=ledger_reader_qos)
        self.own_reader = (own_reader, self.core.handle_own_sample, label)

    def _topic(self, agent_id):
        with self._topics_lock:
            if agent_id not in self._topics:
                self._topics[agent_id] = Topic(self.participant, data_topic_name(agent_id), DataMessage)
            return self._topics[agent_id]

    def _send(self, agent_id, message_type, payload):
        # Queued; written by the I/O thread.
        self._outbox.put((agent_id, message_type, json.dumps(payload)))

    def _io_loop(self):
        while self.running:
            with self._readers_lock:
                readers = [self.own_reader] + list(self.robot_readers.values())
                for reader, handler, label in readers:
                    _dispatch(reader, handler, label)
            while True:
                try:
                    self._write(*self._outbox.get_nowait())
                except queue.Empty:
                    break
            time.sleep(IO_POLL_PERIOD_S)

    def _write(self, agent_id, message_type, data):
        try:
            writer = self._writers.get(agent_id)
            if writer is None:
                # Directed sync responses expire (Lifespan) so a restarted robot's new reader is
                # not handed our last, stale response and treats us as already synced.
                qos = reliable_qos if agent_id == self.central_id else reliable_transient_local_command_qos
                writer = DataWriter(self.publisher, self._topic(agent_id), qos=qos)
                self._writers[agent_id] = writer
            writer.write(DataMessage(
                message_type=message_type,
                sending_agent=self.central_id,
                timestamp=int(time.time()),
                data=data,
            ))
        except Exception as exc:
            dds_warn(COMPONENT, f"failed to send {message_type} to DataTopic{agent_id}: {exc!r}")

    def _update_fleet(self):
        robots = {int(a) for a in fetch_subscribed_agent_ids_set(self.graphql_server, self.central_id)}
        robots.discard(self.central_id)
        robots.discard(-1)
        with self._readers_lock:
            for r in robots - set(self.robot_readers):
                dds_log(COMPONENT, f"subscribed to agent {r} ledger")
                handler = lambda sender, mtype, data, ts, r=r: self.core.handle_robot_sample(r, sender, mtype, data, ts)
                reader = DataReader(self.subscriber, self._topic(r), qos=ledger_reader_qos)
                self.robot_readers[r] = (reader, handler, data_topic_name(r))
            for r in set(self.robot_readers) - robots:
                dds_log(COMPONENT, f"unsubscribed from agent {r} ledger")
                dispose_entity(self.robot_readers.pop(r)[0])
        self.core.set_robots(robots)

    def _sync_loop(self):
        time.sleep(DISCOVERY_GRACE_S)
        while self.running:
            pending = self.core.sync_tick()
            if pending:
                dds_log(COMPONENT, f"sync request to {pending}")
            time.sleep(SYNC_PERIOD_S)

    def _publish_loop(self):
        try:
            self.map_tf = self._tf_watch.wait()
        except RuntimeError as exc:
            dds_warn(COMPONENT, f"no transform; publishing reference-frame positions: {exc}")
        last = 0.0
        while self.running:
            map_tf = self._tf_watch.refresh()
            if map_tf is not None:
                self.map_tf = map_tf
                self.core.dirty = True  # republish positions in the new frame
            now = time.time()
            if self.core.dirty or now - last >= REFRESH_PERIOD_S:
                objects = self.core.take_snapshot(self.map_tf)
                try:
                    parse_graphql_response(post_graphql(
                        self.graphql_server,
                        SET_LEDGER_OBJECTS_MUTATION,
                        {"objects": json.dumps(objects)},
                    ))
                    last = now
                except Exception as exc:
                    self.core.dirty = True
                    self._graphql_warn.failure(COMPONENT, lambda exc=exc: f"setLedgerObjects failed: {exc}")
            time.sleep(PUBLISH_PERIOD_S)

    def run(self):
        threading.Thread(target=self._io_loop, daemon=True).start()
        threading.Thread(target=self._sync_loop, daemon=True).start()
        threading.Thread(target=self._publish_loop, daemon=True).start()
        dds_log(COMPONENT, f"ready (central_id={self.central_id})")
        while self.running:
            try:
                self._update_fleet()
                self._graphql_warn.success()
            except Exception as exc:
                self._graphql_warn.failure(COMPONENT, lambda exc=exc: f"GraphQL poll failed: {exc}")
            time.sleep(1)

    def shutdown(self):
        dds_log(COMPONENT, "stopped")
        self.running = False
        with self._readers_lock:
            self.robot_readers.clear()
        self._writers.clear()
        dispose_participant(self.participant)
        self.participant = None


if __name__ == "__main__":
    time.sleep(10)  # wait for entry/initialization, like the other central scripts
    try:
        agent_id = require_agent_id_int()
    except AgentIdError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    node = CentralLedgerNode(agent_id)

    def handle_signal(sig, frame):
        node.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_signal)
    try:
        node.run()
    except KeyboardInterrupt:
        node.shutdown()
