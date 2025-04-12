from cyclonedds.domain import DomainParticipant, DomainParticipantQos
from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber, DataReader
from cyclonedds.pub import Publisher, DataWriter
from cyclonedds.util import duration
from cyclonedds.idl import IdlStruct
from cyclonedds.idl.types import sequence
from cyclonedds.core import Qos, Policy, Listener
from cyclonedds.builtin import BuiltinDataReader, BuiltinTopicDcpsParticipant

import time
import os
import socket
import signal
import hashlib
import numpy as np
import requests
import json

from message_defs import Heartbeat, reliable_qos, best_effort_qos

from pyignite import Client

HEARTBEAT_PERIOD = 10    # seconds
HEARTBEAT_TIMEOUT = 30   # seconds

AGENTS_QUERY =  """
                    query {
                        subscribed_agents {
                            id
                        }
                    }
                """ 

class HeartbeatListener(Listener):
    """
    Listener class that handles heartbeat data from agents.

    Attributes:
        heartbeats (dict): A dictionary to store the heartbeats of agents.
        my_id (int): The ID of the current agent.
        agents (dict): A dictionary to store information about all agents in the environment.
    """

    def __init__(self, my_id):
        super().__init__()
        self.heartbeats = dict()
        self.new_heartbeats = dict()
        self.my_id = my_id

        self.R = None
        self.t = None

    def on_data_available(self, reader):
        """
        Callback method called when data is available in the reader.

        Args:
            reader (DataReader): The DataReader object.

        Returns:
            None
        """
        for sample in reader.read():

            # Skip messages from self
            if sample.agent_id == int(self.my_id):
                continue

            self.new_heartbeats[sample.agent_id] = sample.timestamp
            self.heartbeats[sample.agent_id] = sample.timestamp

    def get_heartbeats(self):
        """
        Get a copy of the heartbeats dictionary.

        Returns:
            dict: A copy of the heartbeats dictionary.
        """
        returned_heartbeats = self.new_heartbeats.copy()
        return returned_heartbeats

def hash_func(robot_id):
    """
    Hashes the given robot ID using SHA-256 algorithm.

    Parameters:
    robot_id (str): The robot ID to be hashed.

    Returns:
    int: The hashed robot ID as an integer.

    """
    return int(hashlib.sha256(robot_id.encode()).hexdigest(), 16)


class HeartbeatSubscriber:

    def __init__(self, server_url='http://192.168.50.2:8000/graphql'):

        # Get the agent ID from the environment variable
        self.my_id = os.getenv('AGENT_ID')
        if self.my_id is None:
            raise ValueError("AGENT_ID environment variable not set")
        
        self.my_hash = hash_func(self.my_id)
        self.graphql_server = server_url

        # Get IP Address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # This doesn't have to be reachable; it just has to be a valid address
        s.connect(("8.8.8.8", 80))
        self.my_ip = s.getsockname()[0]
        s.close()

        # Dictionary to store agents in the environment
        self.agents = dict()

        self.lease_duration_ms = 30000
        qos_profile = DomainParticipantQos()
        qos_profile.lease_duration = duration(milliseconds=self.lease_duration_ms)

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = DomainParticipant(qos=qos_profile)
        self.subscriber = Subscriber(self.participant)

        self.heartbeat_topic = Topic(self.participant, 'HeartbeatTopic', Heartbeat)
        self.heartbeat_listener = HeartbeatListener(self.my_id)
        self.heartbeat_reader = DataReader(self.subscriber, self.heartbeat_topic, listener=self.heartbeat_listener, qos=best_effort_qos)

    def run(self):
        
        last_time = int(time.time())
        while True:
            current_time = int(time.time())

            if current_time - last_time >= HEARTBEAT_PERIOD:
                last_time = current_time

                # Get Current List of Agents:
                current_agents = self.get_agents()

                # Update agents with new heartbeats
                heartbeats = self.heartbeat_listener.get_heartbeats()

                update_to_active_agents = False
                for agent_id in heartbeats.keys():
                    if agent_id not in self.agents:
                        self.agents[agent_id] = {
                            'timestamp': int(time.time())
                        }

                    if agent_id in current_agents:
                        self.agents[agent_id]['timestamp'] = heartbeats[agent_id]
                    else:
                        print(f'Detected heartbeat from unknown agent {agent_id}')
                        agent_hash = hash_func(str(agent_id))

                        # FIXME: Add correct agent_type and ip_address
                        self.agents[agent_id] = {
                            # 'agent_type': 'unknown',
                            # 'ip_address': 'unknown',
                            # 'hash': agent_hash,
                            'timestamp': heartbeats[agent_id]
                        }
                        update_to_active_agents = True

                # Check Periodically for Dead Agents
                dead_agents = []
                for agent_id, agent_info in self.agents.items():

                    # Skip self
                    if agent_id == int(self.my_id):
                        continue

                    time_difference = current_time - agent_info['timestamp']
                
                    if time_difference > HEARTBEAT_TIMEOUT:
                        # Agent has timed out
                        print(f'Agent {agent_id} has timed out')
                        dead_agents.append(agent_id)
                
                # Remove Dead Agents
                for agent_id in dead_agents:
                    self.agents.pop(agent_id)

                if update_to_active_agents or dead_agents:
                    # Update the list of agents in the environment
                    self.update_agents()

    def get_agents(self):
        # Query for any agents
        response = requests.post(self.graphql_server, json={'query': AGENTS_QUERY}, timeout=1)
        if response.status_code == 200:
            data = response.json()

            # Get the agent ids from the response
            agent_ids = data.get('data', {}).get('subscribed_agents', {}).get('id', [])

            if len(agent_ids):
                return set(agent_ids)
            else:
                return set()
        else:
            return set()
        
    def update_agents(self):
        mutation = """
            mutation($agentList: [Int!]!) {
            setAgentList(agent_list: $agentList)
            }
        """
        agent_list = list(self.agents.keys())

        response = requests.post(
            self.graphql_server,
            json={'query': mutation, 'variables': {'agentList': agent_list}},
            timeout=1
        )

    def shutdown(self):
        pass

if __name__ == "__main__":
    # Create an instance of the HeartbeatSubscriber and run it
    subscriber = HeartbeatSubscriber()

    def handle_signal(sig, frame):
        subscriber.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    time.sleep(10)  # Wait for the participant to do entry and initialization
    try:
        subscriber.run()
    except KeyboardInterrupt:
        print("Heartbeat subscriber stopped.")
        exit(0)