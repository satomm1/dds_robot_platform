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
class Location(IdlStruct):
    """
    Represents the location of an agent.

    Attributes:
        agent_id (int): The ID of the agent.
        timestamp (int): The timestamp of the location message.
        x (float): The x-coordinate of the agent.
        y (float): The y-coordinate of the agent.
        theta (float): The orientation of the agent.
    """
    agent_id: int
    timestamp: int
    x: float
    y: float
    theta: float

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

    def __init__(self, my_id):
        super().__init__()
        self.my_id = my_id
        self.locations = (None, None, None)

    def on_data_available(self, reader):
        """
        Callback method called when data is available.

        Args:
            reader: The data reader object.

        Returns:
            None
        """
        for sample in reader.read():

            # Skip messages from self
            if sample.agent_id == int(self.my_id):
                continue

            if sample.x is not None and sample.y is not None and sample.theta is not None:
                self.locations = (sample.x, sample.y, sample.theta)
                ignite_data = {"x": sample.x, "y": sample.y, "theta": sample.theta, "timestamp": sample.timestamp}
                ignite_data = json.dumps(ignite_data).encode('utf-8')
                robot_position_cache.put(int(sample.agent_id), ignite_data)

    def get_locations(self):
        """
        Returns the locations dictionary.

        Returns:
            dict: Dictionary containing agent locations.
        """
        return self.locations

class CommManager:
    def __init__(self, my_id):

        self.my_id = my_id

        self.subscribed_agents_cache = ignite_client.get_or_create_cache('subscribed_agents')
        self.subscribed_agents = set()

        agents_to_subscribe = json.loads(self.subscribed_agents_cache.get(1))
        if agents_to_subscribe[0] != -1:
            self.subscribed_agents = set(agents_to_subscribe)

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
        self.participant = DomainParticipant(qos=qos_profile)
        self.subscriber = Subscriber(self.participant)
        self.publisher = Publisher(self.participant)

        self.location_listeners = dict()
        self.location_readers = dict()

        for agent_id in self.subscribed_agents:
            print("Location subscribed to agent ", agent_id)
            new_location_topic = Topic(self.participant, 'LocationTopic' + str(agent_id), Location)
            self.location_listeners[agent_id] = LocationListener(self.my_id)
            self.location_readers[agent_id] = DataReader(self.subscriber, new_location_topic, listener=self.location_listeners[agent_id], qos=self.best_effort_qos)
    def run(self):
        while True:
            
            try:
                agents_to_subscribe = json.loads(self.subscribed_agents_cache.get(1))
                if agents_to_subscribe[0] != -1:
                    agents_to_subscribe = set(agents_to_subscribe)
                    new_agents = agents_to_subscribe - self.subscribed_agents
                    old_agents = self.subscribed_agents - agents_to_subscribe

                    for agent_id in new_agents:
                        print("Location subscribed to agent ", agent_id)
                        new_location_topic = Topic(self.participant, 'LocationTopic' + str(agent_id), Location)
                        self.location_listeners[agent_id] = LocationListener(self.my_id)
                        self.location_readers[agent_id] = DataReader(self.subscriber, new_location_topic, listener=self.location_listeners[agent_id], qos=self.best_effort_qos)


                    for agent_id in old_agents:
                        print("Location unsubscribed from agent ", agent_id)
                        self.location_readers[agent_id] = None
                        self.location_listeners.pop(agent_id)
                        self.location_listeners[agent_id] = None
                        self.location_readers.pop(agent_id)

                    self.subscribed_agents = agents_to_subscribe
            except Exception as e:
                pass

            time.sleep(1)
                            
if __name__ == '__main__':

    ignite_client = Client()
    ignite_client.connect('localhost', 10800)
    robot_position_cache = ignite_client.get_or_create_cache('robot_position')

    time.sleep(5)
    comm_manager = CommManager(101)

    try:
        comm_manager.run()
    except KeyboardInterrupt:
        ignite_client.close()
        print('Exiting...')
        exit(0)
    