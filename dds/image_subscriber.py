from cyclonedds.domain import DomainParticipant, DomainParticipantQos
from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber, DataReader
from cyclonedds.util import duration
from cyclonedds.idl.types import sequence
from cyclonedds.core import Qos, Policy, Listener

import influxdb_client
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

import time
import json
import numpy as np
import signal
import os
import requests
from PIL import Image

from message_defs import ImageMessage, reliable_qos, best_effort_qos, get_ip

AGENTS_QUERY = """
                    query {
                        subscribed_agents {
                            id
                        }
                    }
               """ 

TRANSFORM_QUERY =   """
                        query {
                            transform {
                                R
                                t
                                timestamp
                            }
                        }   
                    """

class ImageListener(Listener):

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
        if self.R is None:
            return point

        point_xy = np.array([point[0], point[1]])
        if forward:
            new_point_xy = self.R @ point_xy + self.t
            new_point_theta = point[2] + np.arctan2(self.R[1, 0], self.R[0, 0])
            return np.concatenate((new_point_xy, [new_point_theta]))
        else:
            new_point_xy = self.R.T @ (point_xy - self.t)
            new_point_theta = point[2] - np.arctan2(self.R[1, 0], self.R[0, 0])
            return np.concatenate((new_point_xy, [new_point_theta]))

    def update_transformation(self, R, t):
        self.R = R
        self.t = t

    def on_data_available(self, reader):
        for sample in reader.read():

            timestamp = sample.timestamp
            print(f"Received image with timestamp: {timestamp}")

            # Save the image to a file
            image_data = np.array(sample.data)
            image_array = image_data.reshape((sample.height, sample.width, 3))
            image = Image.fromarray(image_array.astype('uint8'), 'RGB')
            image_filename = "images/image_{}_{}.png".format(self.topic_id, timestamp)  # Image format is image_topic_{id}_{timestamp}.png
            image.save(image_filename)

            # Write file name to influxDB
            if self.influx_write_api is not None:
                point = Point("image_data") \
                    .tag("robot_id", self.topic_id) \
                    .field("image_filename", image_filename) \
                    .time(timestamp, WritePrecision.S)
                self.influx_write_api.write(bucket="first_bucket", org="eig", record=point)


class ImageSubscriber:

    def __init__(self, my_id, server_url=None, influx_client=None):

        self.my_id = my_id
        self.influx_client = influx_client
        self.influx_write_api = self.influx_client.write_api(write_options=SYNCHRONOUS)

        self.my_ip = get_ip()
        # GraphQL server URL
        if server_url is None:
            self.graphql_server =  f"http://{self.my_ip}:8000/graphql" 
        else:
            self.graphql_server = server_url

        self.subscribed_agents = self.get_agents()

        # Get the transformation matrix from Ignite
        self.R = None
        self.t = None

        self.get_transform()

        self.lease_duration_ms = 30000
        qos_profile = DomainParticipantQos()
        qos_profile.lease_duration = duration(milliseconds=self.lease_duration_ms)

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = DomainParticipant(qos=qos_profile)
        self.subscriber = Subscriber(self.participant)

        self.image_listeners = dict()
        self.image_readers = dict()

        for agent_id in self.subscribed_agents:
            print(f"Subscribed to agent {agent_id} images")
            new_image_topic = Topic(self.participant, 'ImageTopic' + str(agent_id), ImageMessage)
            self.image_listeners[agent_id] = ImageListener(my_id, agent_id, self.graphql_server, influx_write_api=self.influx_write_api)
            self.image_listeners[agent_id].update_transformation(self.R, self.t)
            self.image_readers[agent_id] = DataReader(self.subscriber, new_image_topic, listener=self.image_listeners[agent_id], qos=reliable_qos)

    def run(self):
        while True:

            try:
                agents_to_subscribe = self.get_agents()
                new_agents = agents_to_subscribe - self.subscribed_agents
                old_agents = self.subscribed_agents - agents_to_subscribe

                for agent_id in new_agents:
                    if int(agent_id) == int(self.my_id):
                        continue

                    print(f"    Subscribed to agent {agent_id} images")
                    new_image_topic = Topic(self.participant, 'ImageTopic' + str(agent_id), ImageMessage)
                    self.image_listeners[agent_id] = ImageListener(self.my_id, agent_id, self.graphql_server, influx_write_api=self.influx_write_api)
                    self.image_listeners[agent_id].update_transformation(self.R, self.t)
                    self.image_readers[agent_id] = DataReader(self.subscriber, new_image_topic, listener=self.image_listeners[agent_id], qos=reliable_qos)


                for agent_id in old_agents:
                    print(f"    Unsubscribed from agent {agent_id} images")
                    self.image_listeners[agent_id] = None
                    self.image_readers[agent_id] = None
                    self.image_listeners.pop(agent_id)
                    self.image_readers.pop(agent_id)

                self.subscribed_agents = agents_to_subscribe
            except Exception as e:
                pass

            time.sleep(1)

    def get_agents(self):
        # Query for any agents
        response = requests.post(self.graphql_server, json={'query': AGENTS_QUERY}, timeout=1)
        if response.status_code == 200:
            data = response.json()

            # Get the agent ids from the response
            agent_ids = data.get('data', {}).get('subscribed_agents', {}).get('id', [])

            if int(self.my_id) in agent_ids:
                agent_ids.remove(int(self.my_id))
            elif self.my_id in agent_ids:
                agent_ids.remove(self.my_id)

            if len(agent_ids):
                return set(agent_ids)
            else:
                return set()
        else:
            return set()

    def get_transform(self):
        # Query for the transform
        response = requests.post(self.graphql_server, json={'query': TRANSFORM_QUERY}, timeout=1)
        data = response.json()
        transform = data.get('data', {}).get('transform', {})
        R = transform.get('R', [])
        t = transform.get('t', [])
        
        while len(R) != 4 or len(t) != 2:
            response = requests.post(self.graphql_server, json={'query': TRANSFORM_QUERY}, timeout=1)
            data = response.json()
            transform = data.get('data', {}).get('transform', {})
            R = transform.get('R', [])
            t = transform.get('t', [])
            time.sleep(1)

        self.R = np.array(R).reshape((2, 2))
        self.t = np.array(t)

    def shutdown(self):
        print("Image Subscriber stopped\n")

if __name__ == "__main__":

    def handle_signal(sig, frame):
        image_sub.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    time.sleep(10)  # Wait for the participant to do entry and initialization
    # Create an instance of the ImageSubscriber
    agent_id = os.getenv('AGENT_ID')
    if agent_id is None:
        raise ValueError("AGENT_ID environment variable not set")
    
    token = os.environ.get("INFLUXDB_TOKEN")
    if token is None:
        raise ValueError("INFLUXDB_TOKEN environment variable not set")
    org = "eig"
    url = "http://localhost:8086"
    write_client = influxdb_client.InfluxDBClient(url=url, token=token, org=org)

    image_sub = ImageSubscriber(agent_id, influx_client=write_client)

    def handle_signal(sig, frame):
        image_sub.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    try:
        image_sub.run()
    except KeyboardInterrupt:
        print('Exiting...')
        exit(0)