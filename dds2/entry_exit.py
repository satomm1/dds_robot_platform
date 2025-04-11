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
import signal

from pyignite import Client

from ros_messages import Header, Origin, Position, Quaternion, MapMetaData, OccupancyGrid, msg_to_dict
from message_defs import Heartbeat, EntryExit, Initialization


# Constants (Set depending on the agent)
HEARTBEAT_PERIOD = 10    # seconds
HEARTBEAT_TIMEOUT = 31  # seconds
AGENT_TYPE = 'human'


class EntryExitListener(Listener):
    """
    Listener class for handling entry and exit events of agents in the environment.

    Attributes:
    - participant (Participant): The DDS participant.
    - publisher (Publisher): The DDS publisher.
    - subscriber (Subscriber): The DDS subscriber.
    - my_id (int): The ID of the current agent.
    - my_ip (str): The IP address of the current agent.
    - my_hash (int): The hash value of the current agent.
    - init_writer (Writer): The writer for sending initialization messages.
    - agents (dict): Dictionary of active agents in the environment.
    - exited_agents (dict): Dictionary of agents that have exited the environment.
    - lost_agents (dict): Dictionary of agents that have been lost.
    - map_msg (OccupancyGrid): The occupancy grid map message.
    - map_md_msg (MapMetaData): The map metadata message.
    - update_to_agents (bool): Flag indicating if there are updates to be sent to agents.

    Methods:
    - on_data_available(reader): Callback method for handling incoming data.
    - find_if_closest_robot(robot_hash): Determines if the given robot is the closest robot to the current agent.
    - agent_update_available(): Checks if there are updates to be sent to agents.
    - get_agents(): Retrieves the active agents, exited agents, and lost agents.
    - update_agents(agents): Updates the active agents.
    - update_map(map, map_md): Updates the occupancy grid map and map metadata.
    """

    def __init__(self, participant, publisher, subscriber, my_id, my_ip, my_hash, init_writer):
        super().__init__()
        self.participant = participant
        self.publisher = publisher
        self.subscriber = subscriber

        self.agents = dict()     
        self.agents[my_hash] = {
            'agent_type': AGENT_TYPE,
            'ip_address': my_ip,
            'hash': my_hash
        }  

        self.my_id = my_id
        self.my_ip = my_ip
        self.my_hash = my_hash
        self.map_msg = OccupancyGrid()
        self.map_mod_msg = OccupancyGrid()
        self.map_md_msg = MapMetaData()
        self.known_points = []
        self.init_writer = init_writer

        self.update_to_agents = False

    def on_data_available(self, reader):
        """
        Callback method for handling incoming data.

        Parameters:
        - reader (Reader): The DDS reader.

        Returns:
        - None
        """
        for sample in reader.read():

            # Skip messages from self
            if sample.agent_id == int(self.my_id):
                continue

            # Determine what type of message was received
            if sample.action == 'enter':
                new_robot_hash = hash_func(str(sample.agent_id))
                # If the new agent is the closest robot, send an initialization message
                # The initalization message contains the map, map metadata, and all agents in the environment
                if self.find_if_closest_robot(new_robot_hash):
                    print(f'Agent {sample.agent_id} of type \'{sample.agent_type}\' is requesting entry')

                    # Message containing details of all active agents
                    agents_message = json.dumps(self.agents)

                    known_points_json = json.dumps(self.known_points)

                    init_message = Initialization(target_agent=sample.agent_id, sending_agent=int(self.my_id), agents=agents_message, known_points=known_points_json)
                    self.init_writer.write(init_message)

                    print("Sent initialization message to new agent")
            elif sample.action == "initialized":
                # Only if the sample.timestamp is recent
                if int(time.time()) - sample.timestamp < 10: 
                    print(f'Agent {sample.agent_id} of type \'{sample.agent_type}\' entered the environment')

                    # Agent initialized, add to agents dictionary
                    new_robot_hash = hash_func(str(sample.agent_id))
                    self.agents[sample.agent_id] = {
                        'agent_type': sample.agent_type,
                        'ip_address': sample.ip_address,
                        'hash': new_robot_hash,
                        'timestamp': sample.timestamp
                    }  
                    
                    self.update_to_agents = True
            elif sample.action == 'exit':
                # Agent Exited, remove from agents dictionary
                if sample.agent_id in self.agents:
                    print(f'Agent {sample.agent_id} exited the environment')
                    self.agents.pop(sample.agent_id)
                    self.update_to_agents = True

    def find_if_closest_robot(self, robot_hash):
        """
        Finds if the given robot is the closest robot to the current agent.
        The closest robot is the robot that has the smallest difference in hash value

        Parameters:
        - robot_hash (int): The hash value of the robot.

        Returns:
        - bool: True if the given robot is the closest robot, False otherwise.
        """
        my_distance = abs(self.my_hash - robot_hash)

        for agent_id, agent_info in self.agents.items():
            agent_hash = agent_info['hash']

            distance = abs(agent_hash - robot_hash)
            if distance < my_distance and distance != 0:
                print("I will not provide initialization.")
                return False

        print('I will provide initialization.')
        return True

    def agent_update_available(self):
        """
        Checks if there are updates to be sent to agents.

        Returns:
        - bool: True if there are updates, False otherwise.
        """
        return self.update_to_agents

    def get_agents(self):
        """
        Retrieves the active agents, exited agents, and lost agents.

        Returns:
        - tuple: A tuple containing the active agents, exited agents, and lost agents.
        """
        self.update_to_agents = False
        return self.agents
    
    def update_agents(self, agents=None):
        """
        Updates the active agents.

        Parameters:
        - agents (dict): The updated dictionary of active agents.

        Returns:
        - None
        """
        if agents is not None:
            self.agents = agents

    def update_known_points(self, known_points):
        """
        Updates the known points in the environment.

        Parameters:
        - known_points (list): A list of known points in the environment.

        Returns:
        - None
        """
        self.known_points = known_points


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
        self.locations = dict()
        self.new_locations = dict()
        self.my_id = my_id

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

            if sample.location_valid:

                new_point = self.transform_point([sample.x, sample.y, sample.theta], forward=False)
                x = new_point[0]
                y = new_point[1]
                theta = new_point[2]

                self.locations[sample.agent_id] = (x, y, theta)
                self.new_locations[sample.agent_id] = (x, y, theta)
            else:
                self.locations[sample.agent_id] = None
                self.new_locations[sample.agent_id] = None

    def get_heartbeats(self):
        """
        Get a copy of the heartbeats dictionary.

        Returns:
            dict: A copy of the heartbeats dictionary.
        """
        returned_heartbeats = self.new_heartbeats.copy()
        return returned_heartbeats

    def get_heartbeats_and_locations(self):
        """
        Get a copy of the heartbeats and locations dictionaries.

        Returns:
            tuple: A tuple containing copies of the heartbeats and locations dictionaries.
        """
        returned_heartbeats = self.new_heartbeats.copy()
        self.new_heartbeats = dict()

        returned_locations = self.new_locations.copy() 
        self.new_locations = dict()

        return returned_heartbeats, returned_locations
    
    # TODO Should provide function to alert of new agents detected through heartbeats

class InitializationListener(Listener):
    """
    Listener class for handling initialization messages.

    Attributes:
        map_received (bool): Flag indicating if the map has been received.
        map_msg (OccupancyGrid): OccupancyGrid message containing the map data.
        map_md_msg (MapMetaData): MapMetaData message containing the map metadata.
        agents (dict): Dictionary containing information about the agents.
        my_id (int): ID of the current agent.
        map_publisher: Publisher for the map message.
        map_md_publisher: Publisher for the map metadata message.
    """

    def __init__(self, my_id):
        super().__init__()
        self.map_received = False
        self.map_msg = OccupancyGrid()
        self.map_mod_msg = OccupancyGrid()
        self.map_md_msg = MapMetaData()
        self.agents = dict()
        self.my_id = my_id
        self.known_points_received = False
        self.reference_known_points = []

    def on_data_available(self, init_reader):
        """
        Callback function called when initialization data is available.

        Args:
            init_reader: Reader object for reading initialization data.
        """
        for sample in init_reader.read():

            sending_agent = sample.sending_agent
            if sending_agent == int(self.my_id):
                continue

            print(f'Initialization message received from agent {sending_agent}')

            if sample.target_agent != int(self.my_id):
                continue

            agent_dict = json.loads(sample.agents)
            if len(agent_dict) > 0:
                # Cycle through agents in the initialization message and insert into our agents dictionary
                for agent_id, agent_info in agent_dict.items():
                    if agent_id != self.my_id:
                        agent_type = agent_info['agent_type']
                        ip_address = agent_info['ip_address']
                        agent_hash = agent_info['hash']
                        timestamp = agent_info['timestamp']
                        self.agents[int(agent_id)] = {
                            'agent_type': agent_type,
                            'ip_address': ip_address,
                            'hash': agent_hash,
                            'timestamp': timestamp
                        }

            # Load the known points from the initialization message
            known_points = json.loads(sample.known_points)
            self.reference_known_points = known_points
            self.known_points_received = True

            print("Reference points received through initialization message")

    def map_available(self):
        """
        Check if the map has been received.

        Returns:
            bool: True if the map has been received, False otherwise.
        """
        return self.map_received
    
    def known_points_available(self):
        """
        Check if the known points have been received.

        Returns:
            bool: True if the known points have been received, False otherwise.
        """
        return self.known_points_received

    def get_map(self):
        """
        Get the map and map metadata.

        Returns:
            tuple: A tuple containing the map message and map metadata message.
        """
        return self.map_msg, self.map_mod_msg, self.map_md_msg

    def get_known_points(self):
        """
        Get the known points in the environment.

        Returns:
            list: A list of known points in the environment.
        """
        return self.reference_known_points

    def get_agents(self):
        """
        Get the agents dictionary.

        Returns:
            dict: Dictionary containing information about the agents.
        """
        return self.agents

def hash_func(robot_id):
    """
    Hashes the given robot ID using SHA-256 algorithm.

    Parameters:
    robot_id (str): The robot ID to be hashed.

    Returns:
    int: The hashed robot ID as an integer.

    """
    return int(hashlib.sha256(robot_id.encode()).hexdigest(), 16)

class EntryExitCommunication:

    def __init__(self, agent_id, server_url='http://192.168.50.2:8000/graphql'):

        # Get agent ID, Hash, and IP Address
        self.my_id = agent_id
        self.my_hash = hash_func(self.my_id)

        # Get IP Address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # This doesn't have to be reachable; it just has to be a valid address
        s.connect(("8.8.8.8", 80))
        self.my_ip = s.getsockname()[0]
        s.close()
        print(f"My IP address is {self.my_ip}")

        # Dictionary to store agents in the environment
        self.agents = dict()

        # Map and Map Metadata messages
        self.map_msg = OccupancyGrid()
        self.map_mod_msg = OccupancyGrid()
        self.map_md_msg = MapMetaData()

        # Create different policies for the DDS entities
        self.reliable_qos = Qos(
            Policy.Reliability.Reliable(max_blocking_time=duration(milliseconds=10)),
            Policy.Durability.TransientLocal,
            Policy.History.KeepLast(depth=1)
        )

        self.best_effort_qos = Qos(
            Policy.Reliability.BestEffort,
            Policy.Durability.Volatile,
            Policy.Liveliness.ManualByParticipant(lease_duration=duration(milliseconds=30000))
        )

        self.lease_duration_ms = 30000
        qos_profile = DomainParticipantQos()
        qos_profile.lease_duration = duration(milliseconds=self.lease_duration_ms)

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = DomainParticipant(qos=qos_profile)
        self.subscriber = Subscriber(self.participant)
        self.publisher = Publisher(self.participant)

        # Create the topics needed
        self.entry_exit_topic = Topic(self.participant, 'EntryExitTopic', EntryExit)
        self.heartbeat_topic = Topic(self.participant, 'HeartbeatTopic', Heartbeat)
        self.init_topic = Topic(self.participant, 'InitializationTopic', Initialization)

        # Create the DataWriters and DataReaders
        self.enter_exit_writer = DataWriter(self.publisher, self.entry_exit_topic, qos=self.reliable_qos)
        self.init_writer = DataWriter(self.publisher, self.init_topic, qos=self.reliable_qos)

        self.entry_exit_listener = EntryExitListener(self.participant, self.publisher, self.subscriber, self.my_id,
                                                     self.my_ip, self.my_hash, self.init_writer)
        self.heartbeat_listener = HeartbeatListener(self.my_id)
        self.init_listener = InitializationListener(self.my_id)

        # We will start the readers later when it is necessary
        self.enter_exit_reader = None
        self.init_reader = None
        self.heartbeat_reader = None
        self.location_readers = dict()
        self.location_listeners = dict()
        self.data_readers = dict()
        self.data_listeners = dict()

        # GraphQL server URL
        self.graphql_server = server_url

        self.last_time = int(time.time())

        detected_objects_cache = ignite_client.get_or_create_cache('detected_objects') 
        detected_objects_cache.clear()

        self.location_cache = ignite_client.get_or_create_cache('robot_position')
        self.path_cache = ignite_client.get_or_create_cache('cmd_smoothed_path')
        self.goal_cache = ignite_client.get_or_create_cache('robot_goal')

        self.subscribed_agents_cache = ignite_client.get_or_create_cache('subscribed_agents')
        self.subscribed_agents_cache.clear()
        null_list = list()
        null_list.append(-1)
        self.subscribed_agents_cache.put(1, json.dumps(null_list))

    def setup(self):
        """
        Sets up the agent by retrieving the map and initializing the environment.

        If the agent is the first to enter the environment, it retrieves the map from a GraphQL server,
        converts the map data into ROS Occupancy grid format, and publishes the map to the appropriate topics.

        If the agent is not the first to enter the environment, it sends an entry message to the enter/exit writer,
        waits for the map to become available, retrieves the map and agent information from the init listener,
        updates the agent information, and publishes the map to the appropriate topics.

        Returns:
            None
        """
        print("Starting Setup")

        # load the map from file
        self.load_map()

        # Now get reference points
        self.known_points = []
        with open('known_points.txt', 'r') as f:
            for line in f:
                x, y = line.split(',')
                self.known_points.append((float(x), float(y)))

        self.entry_exit_listener.update_known_points(self.known_points)

        self.enter_exit_reader = DataReader(self.subscriber, self.entry_exit_topic,
                                                listener=self.entry_exit_listener, qos=self.reliable_qos)
        self.init_reader = DataReader(self.subscriber, self.init_topic, listener=self.init_listener, qos=self.reliable_qos)

        # Broadcast an entry message
        entry_message = EntryExit(int(self.my_id), AGENT_TYPE, 'enter', self.my_ip, int(time.time()))
        self.enter_exit_writer.write(entry_message)

        # Wait for the reference points to become available
        num_tries = 0
        while not self.init_listener.known_points_available() and num_tries < 6:
            print("Reference Points not yet received (attempt {0}/6)".format(num_tries+1))
            time.sleep(1)
            if not self.init_listener.known_points_available():
                entry_message.timestamp = int(time.time())
                self.enter_exit_writer.write(entry_message)
                num_tries += 1

        if self.init_listener.known_points_available():
            print("I am not the first agent, received reference points")

            # Store the map, map metadata, and agents
            self.reference_known_points = self.init_listener.get_known_points()
            self.agents = self.init_listener.get_agents()

            # Add myself to the agents dictionary
            self.agents[int(self.my_id)] = {
                'agent_type': AGENT_TYPE,
                'ip_address': self.my_ip,
                'hash': self.my_hash,
                'timestamp': int(time.time())
            }

            # Update the agents in the entry/exit listener
            self.entry_exit_listener.update_agents(agents=self.agents)
        else: 
            print("I am the first agent, my map will be the reference map")
            self.reference_known_points = self.known_points

            self.agents[int(self.my_id)] = {
                'agent_type': AGENT_TYPE,
                'ip_address': self.my_ip,
                'hash': self.my_hash,
                'timestamp': int(time.time())
            }

        self.create_transform()  # Create the transform from the known points

        # Update the entry/exit listener with the known points
        self.entry_exit_listener.update_known_points(self.reference_known_points)

        # Update the agents in the entry/exit listener
        self.entry_exit_listener.update_agents(agents=self.agents)  

        # Start the heartbeat reader now that we have the reference points, stop listening for initialization messages
        self.init_reader = None
        self.init_listener = None
        self.heartbeat_reader = DataReader(self.subscriber, self.heartbeat_topic, listener=self.heartbeat_listener, qos=self.best_effort_qos)

        # Send confirmation message to entry_exit topic
        entry_message = EntryExit(int(self.my_id), AGENT_TYPE, 'initialized', self.my_ip, int(time.time()))
        self.enter_exit_writer.write(entry_message)

        print("Setup complete")

    def load_map(self):
        # Load the map from the user_map.json file
        with open('user_map.json', 'r') as f:
            map_data = json.load(f)

        map_data = map_data['data']['map'] 
        map_data_str = np.array(map_data['occupancy']).tobytes()
        ignite_map_md_msg = dict()
        ignite_map_md_msg['resolution'] = map_data['resolution']
        ignite_map_md_msg['width'] = map_data['width']
        ignite_map_md_msg['height'] = map_data['height']
        ignite_map_md_msg['origin.position.x'] = map_data['origin_x']
        ignite_map_md_msg['origin.position.y'] = map_data['origin_y']
        ignite_map_md_msg['origin.position.z'] = map_data['origin_z']
        ignite_map_md_msg['origin.orientation.x'] = map_data['origin_orientation_x']
        ignite_map_md_msg['origin.orientation.y'] = map_data['origin_orientation_y']
        ignite_map_md_msg['origin.orientation.z'] = map_data['origin_orientation_z']
        ignite_map_md_msg['origin.orientation.w'] = map_data['origin_orientation_w']
        ignite_map_md_msg = json.dumps(ignite_map_md_msg)

        # Send the map to ignite server
        map_cache = ignite_client.get_or_create_cache('map')
        map_metadata_cache = ignite_client.get_or_create_cache('map_metadata')
        map_cache.put(1, map_data_str)
        map_metadata_cache.put(1, ignite_map_md_msg)

        print("Map loaded from user_map.json")

    def create_transform(self):
        """
        Determines the transform from my map to the reference map
        """
        print("Creating Transform")

        self.R = None
        self.t = None
        if self.known_points == self.reference_known_points:
            self.R = np.identity(2)
            self.t = np.zeros((2,1))
        else:

            # Find the transform from the known points
            known_points = np.array(self.known_points)
            reference_known_points = np.array(self.reference_known_points)

            centroid1 = np.mean(known_points, axis=0)
            centroid2 = np.mean(reference_known_points, axis=0)
            centered_points1 = known_points - centroid1
            centered_points2 = reference_known_points - centroid2

            H = np.dot(centered_points1.T, centered_points2)
            U, S, Vt = np.linalg.svd(H)
            R = Vt.T @ U.T

            if np.linalg.det(R) < 0:
                Vt[1, :] *= -1
                R = Vt.T @ U.T

            t = centroid2 - R @ centroid1

            self.R = R
            self.t = t

        self.heartbeat_listener.update_transformation(self.R, self.t)

        # Now store the transform in the ignite server
        transform_cache = ignite_client.get_or_create_cache('transform')
        transform_data = {"R": self.R.flatten().tolist(), "t": self.t.flatten().tolist(), "timestamp": int(time.time())}
        transform_data = json.dumps(transform_data).encode('utf-8')
        transform_cache.put(1, transform_data)

    def transform_point(self, point, forward=True):
        """
        Transforms a point from the current map to the reference map or vice versa

        Parameters:
        - point (tuple): The point to be transformed.
        - forward (bool): True if transforming from current map to reference map, False otherwise.

        Returns:
        - tuple: The transformed point.
        """
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

    def run(self):

        while True:
            current_time = int(time.time())

            # Periodically perform some updates
            if current_time - self.last_time >= HEARTBEAT_PERIOD:  # FIXME different period...
                self.last_time = current_time

                # Check for new agents
                if self.entry_exit_listener.agent_update_available():
                    self.agents = self.entry_exit_listener.get_agents()
                current_agents_list = list(self.agents.keys())

                # Update agents with new heartbeats
                heartbeats = self.heartbeat_listener.get_heartbeats()

                update_to_active_agents = False
                for agent_id in heartbeats.keys():
                    if agent_id in current_agents_list:
                        self.agents[agent_id]['timestamp'] = heartbeats[agent_id]
                    else:
                        print(f'Detected heartbeat from unknown agent {agent_id}')
                        agent_hash = hash_func(str(agent_id))

                        # FIXME: Add correct agent_type and ip_address
                        self.agents[agent_id] = {
                            'agent_type': 'unknown',
                            'ip_address': 'unknown',
                            'hash': agent_hash,
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

                # Update the entry/exit listener with the new agents
                if update_to_active_agents or dead_agents:
                    self.entry_exit_listener.update_agents(agents=self.agents)

                if len(self.agents) > 1:
                    agent_list = list(self.agents.keys())
                    agent_list.remove(int(self.my_id))  # Remove self from the list
                    self.subscribed_agents_cache.put(1, json.dumps(agent_list))
                else:
                    null_list = list()
                    null_list.append(-1)
                    self.subscribed_agents_cache.put(1, json.dumps(null_list))

            time.sleep(0.2)

    def shutdown(self):
        print('\nSending exit message...\n')
        # Write exit message
        exit_message = EntryExit(int(self.my_id), AGENT_TYPE, 'exit', self.my_ip, int(time.time()))
        self.enter_exit_writer.write(exit_message)


if __name__ == '__main__':

    # Set up the Ignite Client
    ignite_client = Client()
    ignite_client.connect('localhost', 10800)

    entry_exit_obj = EntryExitCommunication('101', server_url='http://localhost:8000/graphql')

    def handle_signal(sig, frame):
        entry_exit_obj.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    entry_exit_obj.setup()
    try:
        entry_exit_obj.run()
    except KeyboardInterrupt:
        entry_exit_obj.shutdown()
        ignite_client.close()
        print('Exiting...')
        exit(0)
