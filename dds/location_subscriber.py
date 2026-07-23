from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber, DataReader
from cyclonedds.core import Listener
from cyclonedds.internal import InvalidSample

import influxdb_client
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS


import time
import json
import numpy as np
import signal
import os
import sys
import requests

from dds_utils import (
    AgentIdError,
    GraphqlPollBackoff,
    Location,
    best_effort_qos,
    create_domain_participant,
    dispose_participant,
    dds_log,
    fetch_subscribed_agent_ids_set,
    fetch_transform_Rt_blocking,
    get_ip,
    require_agent_id_int,
    transform_se2,
)
from dds_utils.config import INFLUX_BUCKET, INFLUX_ORG, INFLUX_URL, resolve_graphql_http_url
from dds_utils.topics import location_topic_name

LOCATION_GRAPHQL_TIMEOUT_SEC = float(os.environ.get("LOCATION_GRAPHQL_TIMEOUT_SEC", "8"))
LOCATION_GRAPHQL_RETRIES = int(os.environ.get("LOCATION_GRAPHQL_RETRIES", "3"))

ROBOT_POSITION_MUTATION =   """
                                mutation($robot_id: Int!, $x: Float!, $y: Float!, $theta: Float!, $position_timestamp: Float!) {
                                    setRobotPosition(robot_id: $robot_id, x: $x, y: $y, theta: $theta, position_timestamp: $position_timestamp)
                                }
                            """

CLEAR_ROBOT_MUTATION = """
                        mutation($robot_id: Int!) {
                            clearRobot(robot_id: $robot_id)
                        }
                    """

def _post_graphql_with_retries(graphql_server, payload, *, context):
    last_exc = None
    for attempt in range(1, LOCATION_GRAPHQL_RETRIES + 1):
        try:
            response = requests.post(
                graphql_server,
                json=payload,
                timeout=LOCATION_GRAPHQL_TIMEOUT_SEC,
            )
            if response.status_code != 200:
                raise RuntimeError(f"{context}: HTTP {response.status_code}")
            body = response.json()
            if body.get("errors"):
                raise RuntimeError(f"{context}: GraphQL errors {body.get('errors')}")
            return response
        except Exception as exc:
            last_exc = exc
            if attempt < LOCATION_GRAPHQL_RETRIES:
                time.sleep(0.1 * attempt)
    raise last_exc


class LocationListener(Listener):
    """
    Listener class that handles location data for agents.

    Attributes:
        my_id (int): The ID of the listener.
        agent_ids (list): List of agent IDs.
        locations (dict): Dictionary to store agent locations.

    Methods:
        on_data_available(reader): Callback method called when data is available.
        get_locations(): Returns the locations dictionary.
        set_agent_ids(agent_ids): Sets the agent IDs and updates the locations dictionary.
    """

    def __init__(self, my_id, my_ip, server_url=None, influx_write_api=None):
        super().__init__()
        self.my_id = my_id
        self.my_ip = my_ip
        self.locations = (None, None, None)

        self.R = None
        self.t = None

        self.graphql_server = resolve_graphql_http_url(my_ip=self.my_ip, server_url=server_url)

        self.influx_write_api = influx_write_api

    def transform_point(self, point, forward=True):
        return transform_se2(self.R, self.t, point, forward)

    def update_transformation(self, R, t):
        self.R = R
        self.t = t

    def on_data_available(self, reader):
        """
        Callback method called when data is available.

        Args:
            reader: The data reader object.

        Returns:
            None
        """
        for sample in reader.read():
            if isinstance(sample, InvalidSample):
                continue

            # Skip messages from self
            if sample.agent_id == int(self.my_id):
                continue

            if sample.x is not None and sample.y is not None and sample.theta is not None:
                x, y, theta = self.transform_point((sample.x, sample.y, sample.theta), forward=False)
                self.locations = (x, y, theta)
                ignite_data = {"x": x, "y": y, "theta": theta, "timestamp": sample.timestamp}
                ignite_data = json.dumps(ignite_data).encode('utf-8')

                # Update the robot position in Ignite
                agent_id = int(sample.agent_id)
                payload = {
                    "query": ROBOT_POSITION_MUTATION,
                    "variables": {
                        "robot_id": agent_id,
                        "x": x,
                        "y": y,
                        "theta": theta,
                        "position_timestamp": float(sample.timestamp),
                    },
                }
                try:
                    _post_graphql_with_retries(
                        self.graphql_server,
                        payload,
                        context=f"setRobotPosition robot_id={agent_id}",
                    )
                except Exception as exc:
                    dds_log("loc_sub", f"setRobotPosition failed robot_id={agent_id}: {exc}")

                # Write to InfluxDB if the write API is available
                if self.influx_write_api is not None:
                    # Write the data to InfluxDB
                    point = Point("robot_position") \
                        .tag("robot_id", str(agent_id)) \
                        .field("x", x) \
                        .field("y", y) \
                        .field("theta", theta) \
                        .time(int(round(float(sample.timestamp) * 1000)), WritePrecision.MS)
                    self.influx_write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)

    def get_locations(self):
        """
        Returns the locations dictionary.

        Returns:
            dict: Dictionary containing agent locations.
        """
        return self.locations

class LocationSubscriber:
    def __init__(self, my_id, server_url=None, influx_client=None):

        self.my_id = my_id
        self.influx_client = influx_client
        self.influx_write_api = self.influx_client.write_api(write_options=SYNCHRONOUS)

        self.my_ip = get_ip()
        self.graphql_server = resolve_graphql_http_url(my_ip=self.my_ip, server_url=server_url)

        self._graphql_warn = GraphqlPollBackoff()

        self.subscribed_agents = self.get_agents()

        # Get the transformation matrix from Ignite
        self.R = None
        self.t = None

        self.get_transform()

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = create_domain_participant(domain_qos=True)
        self.subscriber = Subscriber(self.participant)

        self.location_listeners = dict()
        self.location_readers = dict()

        for agent_id in self.subscribed_agents:
            dds_log("loc_sub", f"subscribed to agent {agent_id} location")
            new_location_topic = Topic(self.participant, location_topic_name(agent_id), Location)
            self.location_listeners[agent_id] = LocationListener(self.my_id, self.my_ip, influx_write_api=self.influx_write_api)
            self.location_listeners[agent_id].update_transformation(self.R, self.t)
            self.location_readers[agent_id] = DataReader(self.subscriber, new_location_topic, listener=self.location_listeners[agent_id], qos=best_effort_qos)

    def run(self):
        dds_log("loc_sub", "ready")
        while True:

            try:
                agents_to_subscribe = self.get_agents()
                self._graphql_warn.success()
                new_agents = agents_to_subscribe - self.subscribed_agents
                old_agents = self.subscribed_agents - agents_to_subscribe

                for agent_id in new_agents:
                    dds_log("loc_sub", f"subscribed to agent {agent_id} location")
                    new_location_topic = Topic(self.participant, location_topic_name(agent_id), Location)
                    self.location_listeners[agent_id] = LocationListener(self.my_id, self.my_ip, influx_write_api=self.influx_write_api)
                    self.location_listeners[agent_id].update_transformation(self.R, self.t)
                    self.location_readers[agent_id] = DataReader(self.subscriber, new_location_topic, listener=self.location_listeners[agent_id], qos=best_effort_qos)

                for agent_id in old_agents:
                    dds_log("loc_sub", f"unsubscribed from agent {agent_id} location")
                    self.location_readers[agent_id] = None
                    self.location_listeners[agent_id] = None
                    self.location_listeners.pop(agent_id)
                    self.location_readers.pop(agent_id)
                    try:
                        _post_graphql_with_retries(
                            self.graphql_server,
                            {
                                "query": CLEAR_ROBOT_MUTATION,
                                "variables": {"robot_id": int(agent_id)},
                            },
                            context=f"clearRobot robot_id={agent_id}",
                        )
                    except Exception as exc:
                        dds_log("loc_sub", f"clearRobot failed for {agent_id}: {exc}")

                self.subscribed_agents = agents_to_subscribe

            except Exception as e:
                self._graphql_warn.failure(
                    "loc_sub",
                    lambda exc=e: f"GraphQL poll failed: {exc}",
                )

            time.sleep(1)

    def get_agents(self):
        return fetch_subscribed_agent_ids_set(self.graphql_server, self.my_id)

    def get_transform(self):
        self.R, self.t = fetch_transform_Rt_blocking(self.graphql_server)
        # print("location_subscriber got the transformation matrix!")

    def shutdown(self):
        dds_log("loc_sub", "stopped")
        self.location_readers.clear()
        self.location_listeners.clear()
        self.subscriber = None
        dispose_participant(self.participant)
        self.participant = None


if __name__ == '__main__':

    try:
        agent_id = require_agent_id_int()
    except AgentIdError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)

    token = os.environ.get("INFLUXDB_TOKEN")
    if token is None:
        raise ValueError("INFLUXDB_TOKEN environment variable not set")
    write_client = influxdb_client.InfluxDBClient(url=INFLUX_URL, token=token, org=INFLUX_ORG)

    time.sleep(10)  # Wait for the participant to do entry and initialization

    # Create an instance of the location subscriber
    loc_subscriber = LocationSubscriber(agent_id, influx_client=write_client)

    def handle_signal(sig, frame):
        loc_subscriber.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    try:
        loc_subscriber.run()
    except KeyboardInterrupt:
        dds_log("loc_sub", "exiting")
        exit(0)
