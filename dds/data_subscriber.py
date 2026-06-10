from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber, DataReader
from cyclonedds.core import Listener

import influxdb_client
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

import time
import os
import sys
import json
import numpy as np
import signal
import requests

from dds_utils import (
    AgentIdError,
    DataMessage,
    GraphqlPollBackoff,
    create_domain_participant,
    dispose_participant,
    dds_log,
    fetch_subscribed_agent_ids_set,
    fetch_transform_Rt_blocking,
    get_ip,
    reliable_qos,
    require_agent_id_int,
    transform_se2,
)
from dds_utils.config import (
    INFLUX_BUCKET,
    INFLUX_ORG,
    INFLUX_URL,
    POSITION_STALE_SEC,
    resolve_graphql_http_url,
)
from dds_utils.gql_queries import ROBOT_POSITION_QUERY
from dds_utils.message_types import MSG_AIR_QUALITY
from dds_utils.topics import data_topic_name


def fetch_fresh_robot_position(graphql_server, robot_id):
    """
    Return (x, y, theta) if Ignite pose has a recent position_timestamp, else None.
    """
    try:
        response = requests.post(
            graphql_server,
            json={
                "query": ROBOT_POSITION_QUERY,
                "variables": {"robot_id": int(robot_id)},
            },
            timeout=1,
        )
        if response.status_code != 200:
            return None
        body = response.json()
        if body.get("errors"):
            return None
        pos = (body.get("data") or {}).get("robotPosition")
        if not pos:
            return None
        ts = pos.get("position_timestamp")
        if ts is None or float(ts) <= 0:
            return None
        age = time.time() - float(ts)
        if age > POSITION_STALE_SEC:
            return None
        x, y, theta = pos.get("x"), pos.get("y"), pos.get("theta")
        if x is None or y is None or theta is None:
            return None
        return float(x), float(y), float(theta)
    except Exception:
        return None

ROBOT_GOAL_MUTATION =   """
                            mutation($robot_id: Int!, $x_goal: Float!, $y_goal: Float!, $theta_goal: Float!, $goal_timestamp: Float!, $from_bot: Boolean, $goal_valid: Boolean) {
                                setRobotGoal(robot_id: $robot_id, x_goal: $x_goal, y_goal: $y_goal, theta_goal: $theta_goal, goal_timestamp: $goal_timestamp, from_bot: $from_bot, goal_valid: $goal_valid)
                            }
                        """

PATH_MUTATION =  """
                    mutation($robot_id: Int!, $x: [Float!]!, $y: [Float!]!, $t: [Float!]!) {
                        setPath(robot_id: $robot_id, x: $x, y: $y, t: $t)
                    }
                """

OBJECT_MUTATION =   """
                        mutation($agent_id: Int!, $x: Float!, $y: Float!, $class_name: String!, $object_num: Int!) {
                            setObjects(agent_id: $agent_id, x: $x, y: $y, class_name: $class_name, object_num: $object_num)
                        }
                    """

CLEAR_OBJECT_MUTATION =     """
                                mutation($agent_id: Int!, $object_num: Int!) {
                                    clearObject(agent_id: $agent_id, object_num: $object_num)
                                }
                            """

SET_AIR_QUALITY_MUTATION = """
    mutation(
        $robot_id: Int!,
        $temperature: Float!,
        $relative_humidity: Float!,
        $voc_index: Float!,
        $nox_index: Float!,
        $timestamp: Float!
    ) {
        setAirQuality(
            robot_id: $robot_id,
            temperature: $temperature,
            relative_humidity: $relative_humidity,
            voc_index: $voc_index,
            nox_index: $nox_index,
            timestamp: $timestamp
        )
    }
"""

class DataListener(Listener):

    def __init__(self, my_id, topic_id, graphql_server, influx_write_api=None):
        super().__init__()
        self.my_id = my_id
        self.topic_id = topic_id
        self.graphql_server = graphql_server
        self.detected_object_num = 0
        self.object_dict = dict()

        self.R = None
        self.t = None

        self.influx_write_api = influx_write_api

    def transform_point(self, point, forward=True):
        return transform_se2(self.R, self.t, point, forward)

    def update_transformation(self, R, t):
        self.R = R
        self.t = t

    def on_data_available(self, reader):
        for sample in reader.read():

            sending_agent = sample.sending_agent

            if sending_agent == int(self.my_id):
                continue

            message_type = sample.message_type
            timestamp = sample.timestamp
            data = json.loads(sample.data)

            if message_type == 'path':
                poses = data['poses']
                x = []
                y = []
                t = []
                for pose in poses:
                    x_new, y_new, _ = self.transform_point([pose['pose']['position']['x'], pose['pose']['position']['y'], 0], forward=False)
                    x.append(x_new)
                    y.append(y_new)
                    t.append(pose['header']['stamp']['secs'] + pose['header']['stamp']['nsecs'] / 1e9)

                dds_log("data_sub", f"path -> GraphQL (agent {sending_agent})")
                response = requests.post(self.graphql_server,
                                json={'query': PATH_MUTATION,
                                    'variables': {
                                        'robot_id': sending_agent,
                                        'x': x,
                                        'y': y,
                                        't': t
                                    }
                                },
                                timeout=1
                            )
            elif message_type == "detected_object":
                class_name = data['class_name']
                pose = data['pose']
                x, y, _ = self.transform_point([pose['position']['x'], pose['position']['y'], 0], forward=False)
                width = data['width']

                self.object_dict[self.detected_object_num] = {'x': x, 'y': y, 'class_name': class_name}

                # Write object to database
                response =  requests.post(
                                self.graphql_server,
                                json={
                                    'query': OBJECT_MUTATION,
                                    'variables': {
                                        'agent_id': self.topic_id,
                                        'x': x,
                                        'y': y,
                                        'class_name': class_name,
                                        'object_num': self.detected_object_num
                                    }
                                },
                                timeout=1
                            )

                self.detected_object_num += 1

                dds_log("data_sub", f"detected object: {class_name}")
            elif message_type == "person_detected":

                dds_log("data_sub", "person_detected")

                pose = data['pose']
                x, y, _ = self.transform_point([pose['position']['x'], pose['position']['y'], 0], forward=False)

                # Write to InfluxDB if the write API is available
                if self.influx_write_api is not None:
                    # Write the data to InfluxDB
                    point = Point("person_detected") \
                    .tag("robot_id", str(self.topic_id)) \
                    .field("x", x) \
                    .field("y", y) \
                    .time(timestamp, WritePrecision.S)
                    self.influx_write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)

            elif message_type == MSG_AIR_QUALITY:
                required = (
                    "temperature",
                    "relative_humidity",
                    "voc_index",
                    "nox_index",
                )
                if not all(k in data for k in required):
                    dds_log(
                        "data_sub",
                        f"air_quality missing fields (agent {self.topic_id}): {data}",
                    )
                    continue

                temperature = float(data["temperature"])
                relative_humidity = float(data["relative_humidity"])
                voc_index = float(data["voc_index"])
                nox_index = float(data["nox_index"])

                requests.post(
                    self.graphql_server,
                    json={
                        "query": SET_AIR_QUALITY_MUTATION,
                        "variables": {
                            "robot_id": int(self.topic_id),
                            "temperature": temperature,
                            "relative_humidity": relative_humidity,
                            "voc_index": voc_index,
                            "nox_index": nox_index,
                            "timestamp": float(timestamp),
                        },
                    },
                    timeout=1,
                )

                pose = fetch_fresh_robot_position(
                    self.graphql_server, int(self.topic_id)
                )
                if self.influx_write_api is not None:
                    if pose is not None:
                        x, y, theta = pose
                        point = (
                            Point("air_quality")
                            .tag("robot_id", str(self.topic_id))
                            .field("temperature", temperature)
                            .field("relative_humidity", relative_humidity)
                            .field("voc_index", voc_index)
                            .field("nox_index", nox_index)
                            .field("x", x)
                            .field("y", y)
                            .field("theta", theta)
                            .time(timestamp, WritePrecision.S)
                        )
                        self.influx_write_api.write(
                            bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point
                        )
                    else:
                        dds_log(
                            "data_sub",
                            f"air_quality skipped Influx: stale position (agent {self.topic_id})",
                        )

            elif message_type == "sensor_detected_objects":
                x = data['x']
                y = data['y']
                w = data['w']
                class_name = data['class']

                sensor_id = sending_agent
                i = 0
                for _ in range(len(x)):
                    object_id = str(sensor_id) + '_' + str(i)
                    x_new, y_new, _ = self.transform_point([x[i], y[i], 0], forward=False)
                    self.object_dict[object_id] = {'x': x_new, 'y': y_new, 'class_name': class_name[i]}
                    i += 1

                while (str(sensor_id) + '_' + str(i)) in self.object_dict:
                    self.object_dict.pop(str(sensor_id) + '_' + str(i))

                    # Clear objects that are not in the current message
                    response =  requests.post(
                                    self.graphql_server,
                                    json={
                                        'query': CLEAR_OBJECT_MUTATION,
                                        'variables': {
                                            'agent_id': self.topic_id,
                                            'object_num': i
                                        }
                                    },
                                    timeout=1
                                )

                    i += 1

                # Write object to database
                for i in range(len(x)):
                    class_name = self.object_dict[str(sensor_id) + '_' + str(i)]['class_name']
                    x = self.object_dict[str(sensor_id) + '_' + str(i)]['x']
                    y = self.object_dict[str(sensor_id) + '_' + str(i)]['y']

                    # Write object to database
                    response =  requests.post(
                                    self.graphql_server,
                                    json={
                                        'query': OBJECT_MUTATION,
                                        'variables': {
                                            'agent_id': self.topic_id,
                                            'x': x,
                                            'y': y,
                                            'class_name': class_name,
                                            'object_num': i
                                        }
                                    },
                                    timeout=1
                                )

            elif message_type == "goal":
                x, y, theta = self.transform_point([data['x'], data['y'], data['theta']], forward=False)
                response =  requests.post(
                                self.graphql_server,
                                json={'query': ROBOT_GOAL_MUTATION,
                                    'variables': {
                                        'robot_id': int(self.topic_id),
                                        'x_goal': x,
                                        'y_goal': y,
                                        'theta_goal': theta,
                                        'goal_timestamp': timestamp,
                                        'from_bot': True,
                                        'goal_valid': True
                                    }
                                },
                                timeout=1
                            )

            elif message_type == "invalid_goal":
                dds_log("data_sub", f"invalid goal (agent {self.topic_id})")
                x, y, theta = self.transform_point([data['x'], data['y'], data['theta']], forward=False)
                response =  requests.post(
                                self.graphql_server,
                                json={'query': ROBOT_GOAL_MUTATION,
                                    'variables': {
                                        'robot_id': int(self.topic_id),
                                        'x_goal': x,
                                        'y_goal': y,
                                        'theta_goal': theta,
                                        'goal_timestamp': timestamp,
                                        'from_bot': True,
                                        'goal_valid': False
                                    }
                                },
                                timeout=1
                            )


class DataSubscriber:
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
        self.participant = create_domain_participant(domain_qos=False)
        self.subscriber = Subscriber(self.participant)

        self.data_listeners = dict()
        self.data_readers = dict()

        for agent_id in self.subscribed_agents:
            dds_log("data_sub", f"subscribed to agent {agent_id} data")
            new_data_topic = Topic(self.participant, data_topic_name(agent_id), DataMessage)
            self.data_listeners[agent_id] = DataListener(self.my_id, agent_id, self.graphql_server, influx_write_api=self.influx_write_api)
            self.data_listeners[agent_id].update_transformation(self.R, self.t)
            self.data_readers[agent_id] = DataReader(self.subscriber, new_data_topic, listener=self.data_listeners[agent_id], qos=reliable_qos)

    def run(self):
        dds_log("data_sub", "ready")
        while True:

            try:
                agents_to_subscribe = self.get_agents()
                self._graphql_warn.success()
                new_agents = agents_to_subscribe - self.subscribed_agents
                old_agents = self.subscribed_agents - agents_to_subscribe

                for agent_id in new_agents:
                    if int(agent_id) == int(self.my_id):
                        continue

                    dds_log("data_sub", f"subscribed to agent {agent_id} data")
                    new_data_topic = Topic(self.participant, data_topic_name(agent_id), DataMessage)
                    self.data_listeners[agent_id] = DataListener(self.my_id, agent_id, self.graphql_server, influx_write_api=self.influx_write_api)
                    self.data_listeners[agent_id].update_transformation(self.R, self.t)
                    self.data_readers[agent_id] = DataReader(self.subscriber, new_data_topic, listener=self.data_listeners[agent_id], qos=reliable_qos)


                for agent_id in old_agents:
                    dds_log("data_sub", f"unsubscribed from agent {agent_id} data")
                    self.data_listeners[agent_id] = None
                    self.data_readers[agent_id] = None
                    self.data_listeners.pop(agent_id)
                    self.data_readers.pop(agent_id)

                self.subscribed_agents = agents_to_subscribe
            except Exception as e:
                self._graphql_warn.failure(
                    "data_sub",
                    lambda exc=e: f"GraphQL poll failed: {exc}",
                )

            time.sleep(1)

    def get_agents(self):
        return fetch_subscribed_agent_ids_set(self.graphql_server, self.my_id)

    def get_transform(self):
        self.R, self.t = fetch_transform_Rt_blocking(self.graphql_server)
        # print("data_subscriber got the transformation matrix!")

    def shutdown(self):
        dds_log("data_sub", "stopped")
        self.data_readers.clear()
        self.data_listeners.clear()
        self.subscriber = None
        dispose_participant(self.participant)
        self.participant = None

if __name__ == '__main__':

    def handle_signal(sig, frame):
        data_sub.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    token = os.environ.get("INFLUXDB_TOKEN")
    if token is None:
        raise ValueError("INFLUXDB_TOKEN environment variable not set")
    write_client = influxdb_client.InfluxDBClient(url=INFLUX_URL, token=token, org=INFLUX_ORG)

    time.sleep(10)  # Wait for the participant to do entry and initialization
    try:
        agent_id = require_agent_id_int()
    except AgentIdError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    data_sub = DataSubscriber(agent_id, influx_client=write_client)

    def handle_signal(sig, frame):
        data_sub.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    try:
        data_sub.run()
    except KeyboardInterrupt:
        dds_log("data_sub", "exiting")
        exit(0)
