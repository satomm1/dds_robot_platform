from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber, DataReader
from cyclonedds.core import Listener

import influxdb_client
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

import requests
import base64

import time
import json
import numpy as np
import signal
import os
import sys
from PIL import Image

from dds_utils import (
    AgentIdError,
    ImageMessage,
    create_domain_participant,
    dispose_participant,
    fetch_subscribed_agent_ids_set,
    fetch_transform_Rt_blocking,
    get_ip,
    reliable_qos,
    require_agent_id_int,
    transform_se2,
)
from dds_utils.config import INFLUX_BUCKET, INFLUX_ORG, INFLUX_URL, OLLAMA_IMAGE_MODEL, OLLAMA_URL
from dds_utils.topics import image_topic_name


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
        return transform_se2(self.R, self.t, point, forward)

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

            image_base64 = encode_image_to_base64(image_filename)

            payload = {
                "model": OLLAMA_IMAGE_MODEL,
                "prompt": "Provide a one sentence description of the contents of this image",
                "images": [image_base64],
                "stream": False,
                "format": {
                    "type": "object",
                        "properties": {
                        "object": {
                            "type": "string"
                        },
                        "description": {
                            "type": "string"
                        }
                    },
                    "required": [
                        "object",
                        "description"
                    ]
                }
            }

            response = requests.post(OLLAMA_URL, json=payload)

            # Write file name to influxDB
            if self.influx_write_api is not None:
                point = Point("image_data") \
                    .tag("robot_id", self.topic_id) \
                    .field("image_filename", image_filename) \
                    .field("image_description", response.json().get('description', '')) \
                    .field("object", response.json().get('object', '')) \
                    .time(timestamp, WritePrecision.S)
                self.influx_write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)

def encode_image_to_base64(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

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

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = create_domain_participant(domain_qos=True)
        self.subscriber = Subscriber(self.participant)

        self.image_listeners = dict()
        self.image_readers = dict()

        for agent_id in self.subscribed_agents:
            print(f"Subscribed to agent {agent_id} images")
            new_image_topic = Topic(self.participant, image_topic_name(agent_id), ImageMessage)
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
                    new_image_topic = Topic(self.participant, image_topic_name(agent_id), ImageMessage)
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
        return fetch_subscribed_agent_ids_set(self.graphql_server, self.my_id)

    def get_transform(self):
        self.R, self.t = fetch_transform_Rt_blocking(self.graphql_server)

    def shutdown(self):
        print("Image Subscriber stopped\n")
        self.image_readers.clear()
        self.image_listeners.clear()
        self.subscriber = None
        dispose_participant(self.participant)
        self.participant = None

if __name__ == "__main__":

    def handle_signal(sig, frame):
        image_sub.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    time.sleep(10)  # Wait for the participant to do entry and initialization
    # Create an instance of the ImageSubscriber
    try:
        agent_id = require_agent_id_int()
    except AgentIdError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)

    token = os.environ.get("INFLUXDB_TOKEN")
    if token is None:
        raise ValueError("INFLUXDB_TOKEN environment variable not set")
    write_client = influxdb_client.InfluxDBClient(url=INFLUX_URL, token=token, org=INFLUX_ORG)

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
