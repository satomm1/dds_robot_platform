import logging
import os
import time

import numpy as np
import requests

from .cli_log import dds_log
from .gql_queries import AGENTS_QUERY, TRANSFORM_QUERY
from .transform import map_transform_from_doc

logger = logging.getLogger(__name__)
SUBSCRIBED_AGENT_QUERY_TIMEOUT_SEC = float(os.environ.get("SUBSCRIBED_AGENT_QUERY_TIMEOUT_SEC", "8"))
SUBSCRIBED_AGENT_QUERY_MAX_RETRIES = int(os.environ.get("SUBSCRIBED_AGENT_QUERY_MAX_RETRIES", "2"))

# A transform pushed within this many seconds before a process started counts as this session's.
TRANSFORM_FRESH_SLACK_S = 10
# How long a process waits at startup for this session's transform before accepting an older stored one.
TRANSFORM_FRESH_WAIT_S = 20
# How often running processes re-read the transform so a newer push from entry_exit is picked up.
TRANSFORM_REFRESH_S = 5


def post_graphql(graphql_server, query, variables=None, timeout=5):
    payload = {"query": query}
    if variables is not None:
        payload["variables"] = variables
    return requests.post(graphql_server, json=payload, timeout=timeout)


def parse_graphql_response(response):
    """
    Raise on HTTP failure, invalid JSON, or top-level GraphQL errors.
    Returns the 'data' object (possibly empty dict).
    """
    if response.status_code != 200:
        raise RuntimeError(f"GraphQL HTTP {response.status_code}: {response.text[:500]}")
    try:
        body = response.json()
    except ValueError as exc:
        raise RuntimeError("GraphQL response is not JSON") from exc
    errs = body.get("errors")
    if errs:
        raise RuntimeError(f"GraphQL errors: {errs}")
    return body.get("data") or {}


def fetch_subscribed_agent_ids_set(graphql_server, my_id):
    last_exc = None
    for attempt in range(1, SUBSCRIBED_AGENT_QUERY_MAX_RETRIES + 1):
        try:
            response = post_graphql(
                graphql_server,
                AGENTS_QUERY,
                timeout=SUBSCRIBED_AGENT_QUERY_TIMEOUT_SEC,
            )
            data = parse_graphql_response(response)
            agent_ids = list(data.get("subscribed_agents", {}).get("id", []))

            if int(my_id) in agent_ids:
                agent_ids.remove(int(my_id))
            elif my_id in agent_ids:
                agent_ids.remove(my_id)

            if len(agent_ids):
                return set(agent_ids)
            return set()
        except Exception as exc:
            last_exc = exc
            if attempt < SUBSCRIBED_AGENT_QUERY_MAX_RETRIES:
                time.sleep(0.2)
    logger.warning("fetch_subscribed_agent_ids_set failed after retries: %s", last_exc)
    return set()


def fetch_map_transform_blocking(graphql_server, max_wait_s=300, poll_s=1.0):
    """
    Poll until transform holds a usable map transform (rigid or TPS), or max_wait_s elapses.
    Returns a RigidMapTransform or TpsMapTransform from dds_utils.transform.
    """
    deadline = time.time() + max_wait_s
    last_error = None
    while time.time() < deadline:
        try:
            response = post_graphql(graphql_server, TRANSFORM_QUERY)
            data = parse_graphql_response(response)
            map_tf = map_transform_from_doc(data.get("transform") or {})
            if map_tf is not None:
                return map_tf
        except Exception as exc:
            last_error = exc
            logger.debug("fetch_map_transform_blocking poll: %s", exc)
        time.sleep(poll_s)
    raise RuntimeError(
        f"Timed out after {max_wait_s}s waiting for valid transform; last_error={last_error!r}"
    )


def fetch_transform_Rt_blocking(graphql_server, max_wait_s=300, poll_s=1.0):
    """
    Poll until transform has a usable 2x2 R and length-2 t, or max_wait_s elapses.
    Returns the rigid (R, t) approximation even when the stored model is TPS.
    """
    map_tf = fetch_map_transform_blocking(graphql_server, max_wait_s=max_wait_s, poll_s=poll_s)
    return np.array(map_tf.R).reshape((2, 2)), np.array(map_tf.t)


class MapTransformWatcher:
    """
    Tracks the map transform stored in GraphQL for one long-running process.

    Ignite keeps the transform from earlier sessions, and every DDS script starts at the same
    time as entry_exit, so a reader can see the previous session's transform before entry_exit
    pushes this one. wait() prefers a transform pushed this session (timestamp no older than
    started_at - TRANSFORM_FRESH_SLACK_S) but accepts the stored one after TRANSFORM_FRESH_WAIT_S,
    so a script restarted on its own does not block. refresh() then picks up any newer push.
    """

    def __init__(self, graphql_server, component, started_at=None):
        self.graphql_server = graphql_server
        self.component = component
        self.started_at = time.time() if started_at is None else started_at
        self.map_tf = None
        self.timestamp = None
        self._last_check = 0.0

    def _poll(self):
        """Return the stored transform doc if it holds a usable transform, else None."""
        try:
            doc = parse_graphql_response(post_graphql(self.graphql_server, TRANSFORM_QUERY)).get("transform") or {}
        except Exception as exc:
            logger.debug("MapTransformWatcher poll: %s", exc)
            return None
        R, t = doc.get("R") or [], doc.get("t") or []
        if len(R) != 4 or len(t) != 2:
            return None
        doc["timestamp"] = doc.get("timestamp") or 0
        return doc

    def _accept(self, doc, note=""):
        map_tf = map_transform_from_doc(doc)
        if map_tf is None:
            return None
        self.map_tf = map_tf
        self.timestamp = doc["timestamp"]
        dds_log(self.component, f"map transform model={map_tf.model}{note}")
        return map_tf

    def wait(self, max_wait_s=300, poll_s=1.0):
        """Block until a transform is accepted; max_wait_s=None waits forever."""
        deadline = None if max_wait_s is None else time.time() + max_wait_s
        while deadline is None or time.time() < deadline:
            doc = self._poll()
            if doc is not None:
                fresh = doc["timestamp"] >= self.started_at - TRANSFORM_FRESH_SLACK_S
                if fresh:
                    if self._accept(doc):
                        return self.map_tf
                elif time.time() - self.started_at > TRANSFORM_FRESH_WAIT_S:
                    age = time.time() - doc["timestamp"]
                    note = (f" (no transform from this session after {TRANSFORM_FRESH_WAIT_S}s;"
                            f" using stored one from {age:.0f}s ago)")
                    if self._accept(doc, note):
                        return self.map_tf
            time.sleep(poll_s)
        raise RuntimeError(f"Timed out after {max_wait_s}s waiting for valid transform")

    def refresh(self):
        """Rate-limited re-read. Returns the new transform if a newer one was stored, else None."""
        now = time.time()
        if now - self._last_check < TRANSFORM_REFRESH_S:
            return None
        self._last_check = now
        doc = self._poll()
        if doc is None or (self.timestamp is not None and doc["timestamp"] <= self.timestamp):
            return None
        return self._accept(doc, " (updated)")
