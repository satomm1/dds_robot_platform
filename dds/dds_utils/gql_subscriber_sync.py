import time

import numpy as np
import requests

from .gql_queries import AGENTS_QUERY, TRANSFORM_QUERY


def fetch_subscribed_agent_ids_set(graphql_server, my_id):
    response = requests.post(graphql_server, json={"query": AGENTS_QUERY}, timeout=1)
    if response.status_code == 200:
        data = response.json()

        agent_ids = data.get("data", {}).get("subscribed_agents", {}).get("id", [])

        if int(my_id) in agent_ids:
            agent_ids.remove(int(my_id))
        elif my_id in agent_ids:
            agent_ids.remove(my_id)

        if len(agent_ids):
            return set(agent_ids)
        return set()
    return set()


def fetch_transform_Rt_blocking(graphql_server):
    response = requests.post(graphql_server, json={"query": TRANSFORM_QUERY}, timeout=1)
    data = response.json()
    transform = data.get("data", {}).get("transform", {})
    R = transform.get("R", [])
    t = transform.get("t", [])

    while len(R) != 4 or len(t) != 2:
        response = requests.post(graphql_server, json={"query": TRANSFORM_QUERY}, timeout=1)
        data = response.json()
        transform = data.get("data", {}).get("transform", {})
        R = transform.get("R", [])
        t = transform.get("t", [])
        time.sleep(1)

    R_np = np.array(R).reshape((2, 2))
    t_np = np.array(t)
    return R_np, t_np
