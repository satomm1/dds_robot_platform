from cyclonedds.domain import DomainParticipant, DomainParticipantQos
from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber, DataReader
from cyclonedds.pub import Publisher, DataWriter
from cyclonedds.util import duration
from cyclonedds.idl import IdlStruct
from cyclonedds.idl.types import sequence
from cyclonedds.core import Qos, Policy, Listener
from cyclonedds.builtin import BuiltinDataReader, BuiltinTopicDcpsParticipant

from dataclasses import dataclass

import time
import os
import hashlib
import socket
import json
import requests
import numpy as np

from pyignite import Client

@dataclass
class DataMessage(IdlStruct):
    message_type: str
    sending_agent: int
    timestamp: int
    data: str

class DataListener(Listener):

    def __init__(self, my_id, topic_id):
        super().__init__()
        self.my_id = my_id
        self.topic_id = topic_id
        self.detected_object_num = 0
        self.object_dict = dict()

        self.path_cache = ignite_client.get_or_create_cache('cmd_smoothed_path')
        self.detected_object_cache = ignite_client.get_or_create_cache('detected_objects')

        self.R = None
        self.t = None

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

                # Write the data to Ignite always
                ignite_data = {"x": x, "y": y, "t": t, "timestamp": timestamp}
                ignite_data = json.dumps(ignite_data).encode('utf-8')

                print(f"Writing path data to Ignite for agent {sending_agent}")
                self.path_cache.put(sending_agent, ignite_data)
            elif message_type == "detected_object":
                class_name = data['class_name']
                pose = data['pose']
                x, y, _ = self.transform_point([pose['position']['x'], pose['position']['y'], 0], forward=False)
                width = data['width']

                self.object_dict[self.detected_object_num] = {'x': x, 'y': y, 'class_name': class_name}

                self.detected_object_num += 1
                ignite_data = json.dumps(self.object_dict).encode('utf-8')
                self.detected_object_cache.put(self.topic_id, ignite_data)

                print(f"*********Detected object {class_name}")
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
                    i += 1

                ignite_data = json.dumps(self.object_dict).encode('utf-8')
                self.detected_object_cache.put(self.topic_id, ignite_data)  


class CommManager:
    def __init__(self, my_id):

        self.my_id = my_id

        self.subscribed_agents_cache = ignite_client.get_or_create_cache('subscribed_agents')
        self.subscribed_agents = set()

        agents_to_subscribe = json.loads(self.subscribed_agents_cache.get(1))
        if agents_to_subscribe[0] != -1:
            self.subscribed_agents = set(agents_to_subscribe)

        # Get the transformation matrix from Ignite
        self.R = None
        self.t = None

        transform_cache = ignite_client.get_or_create_cache('transform')
        while self.R is None:
            transform = json.loads(transform_cache.get(1))
            timestamp = transform.get('timestamp', 0)
            if time.time() - timestamp > 10:
                time.sleep(1)
                continue
            R = transform.get('R', [])
            t = transform.get('t', [])
            if len(R) == 4 and len(t) == 2:
                self.R = np.array(R).reshape((2, 2))
                self.t = np.array(t)
                print("Got the transformation matrix!")
                break
            else:
                time.sleep(1)

        # Create different policies for the DDS entities
        self.reliable_qos = Qos(
            Policy.Reliability.Reliable(max_blocking_time=duration(milliseconds=10)),
            Policy.Durability.TransientLocal,
            Policy.History.KeepLast(depth=1)
        )

        # self.best_effort_qos = Qos(
        #     Policy.Reliability.BestEffort,
        #     Policy.Durability.TransientLocal,
        #     Policy.History.KeepLast(depth=1)
        # )

        self.best_effort_qos = Qos(
            Policy.Reliability.BestEffort,
            Policy.Durability.Volatile,
            Policy.Liveliness.ManualByParticipant(lease_duration=duration(milliseconds=30000))
            # Policy.Deadline(duration(milliseconds=1000))
            # Policy.History.KeepLast(depth=1)
        )

        self.lease_duration_ms = 30000
        qos_profile = DomainParticipantQos()
        qos_profile.lease_duration = duration(milliseconds=self.lease_duration_ms)

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = DomainParticipant()
        # self.participant = DomainParticipant(qos=qos_profile)
        self.subscriber = Subscriber(self.participant)
        self.publisher = Publisher(self.participant)

        self.data_listeners = dict()
        self.data_readers = dict()

        for agent_id in self.subscribed_agents:
            print("Subscribed to agent ", agent_id)
            new_data_topic = Topic(self.participant, 'DataTopic' + str(agent_id), DataMessage)
            self.data_listeners[agent_id] = DataListener(self.my_id, agent_id)
            self.data_listeners[agent_id].update_transformation(self.R, self.t)
            self.data_readers[agent_id] = DataReader(self.subscriber, new_data_topic, listener=self.data_listeners[agent_id], qos=self.reliable_qos)

    def run(self):
        while True:

            try:            
                agents_to_subscribe = json.loads(self.subscribed_agents_cache.get(1))
                if agents_to_subscribe[0] != -1:
                    agents_to_subscribe = set(agents_to_subscribe)
                    new_agents = agents_to_subscribe - self.subscribed_agents
                    old_agents = self.subscribed_agents - agents_to_subscribe

                    for agent_id in new_agents:
                        print("Subscribed to agent ", agent_id)
                        new_data_topic = Topic(self.participant, 'DataTopic' + str(agent_id), DataMessage)
                        self.data_listeners[agent_id] = DataListener(self.my_id, agent_id)
                        self.data_listeners[agent_id].update_transformation(self.R, self.t)
                        self.data_readers[agent_id] = DataReader(self.subscriber, new_data_topic, listener=self.data_listeners[agent_id], qos=self.reliable_qos)


                    for agent_id in old_agents:
                        print("Unsubscribed from agent ", agent_id)
                        self.data_listeners[agent_id] = None
                        self.data_readers[agent_id] = None
                        self.data_listeners.pop(agent_id)
                        self.data_readers.pop(agent_id)

                    self.subscribed_agents = agents_to_subscribe
            except Exception as e:
                pass

            time.sleep(1)
                            
if __name__ == '__main__':

    ignite_client = Client()
    ignite_client.connect('localhost', 10800)

    time.sleep(5)
    comm_manager = CommManager(101)

    try:
        comm_manager.run()
    except KeyboardInterrupt:
        ignite_client.close()
        print('Exiting...')
        exit(0)
    