import logging
import os
import time

import numpy as np
import requests

from .gql_queries import AGENTS_QUERY, TRANSFORM_QUERY

logger = logging.getLogger(__name__)
SUBSCRIBED_AGENT_QUERY_TIMEOUT_SEC = float(os.environ.get("SUBSCRIBED_AGENT_QUERY_TIMEOUT_SEC", "8"))
SUBSCRIBED_AGENT_QUERY_MAX_RETRIES = int(os.environ.get("SUBSCRIBED_AGENT_QUERY_MAX_RETRIES", "2"))


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


def fetch_transform_Rt_blocking(graphql_server, max_wait_s=300, poll_s=1.0):
    """
    Poll until transform has a usable 2x2 R and length-2 t, or max_wait_s elapses.
    """
    deadline = time.time() + max_wait_s
    last_error = None
    while time.time() < deadline:
        try:
            response = post_graphql(graphql_server, TRANSFORM_QUERY)
            data = parse_graphql_response(response)
            transform = data.get("transform", {})
            R = transform.get("R", [])
            t = transform.get("t", [])
            if len(R) == 4 and len(t) == 2:
                R_np = np.array(R).reshape((2, 2))
                t_np = np.array(t)
                return R_np, t_np
        except Exception as exc:
            last_error = exc
            logger.debug("fetch_transform_Rt_blocking poll: %s", exc)
        time.sleep(poll_s)
    raise RuntimeError(
        f"Timed out after {max_wait_s}s waiting for valid transform; last_error={last_error!r}"
    )
