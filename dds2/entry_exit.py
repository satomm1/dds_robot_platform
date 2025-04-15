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
import hashlib
import socket
import json
import requests
import numpy as np
import signal
import base64

from ros_messages import Header, Origin, Position, Quaternion, MapMetaData, OccupancyGrid, msg_to_dict
from message_defs import Heartbeat, EntryExit, Initialization, reliable_qos, best_effort_qos

# Constants (Set depending on the agent)
HEARTBEAT_PERIOD = 10    # seconds
HEARTBEAT_TIMEOUT = 31  # seconds
AGENT_TYPE = 'human'

AGENTS_QUERY =  """
                    query {
                        subscribed_agents {
                            id
                        }
                    }
                """ 

TRANSFORM_MUTATION =   """
                            mutation($R: [Float]!, $t: [Float]!, $timestamp: Float!) {
                                setTransform(R: $R, t: $t, timestamp: $timestamp)
                            }
                        """

MAP_MUTATION =  """
                    mutation($data: String!) {
                        setMap(data: $data)
                    }
                """

MD_MUTATION =   """
                    mutation($resolution: Float!, $width: Int!, $height: Int!, $origin_pos_x: Float!, $origin_pos_y: Float!, $origin_pos_z: Float!, $origin_ori_x: Float!, $origin_ori_y: Float!, $origin_ori_z: Float!, $origin_ori_w: Float!) {
                        setMapMetadata(resolution: $resolution, width: $width, height: $height, origin_pos_x: $origin_pos_x, origin_pos_y: $origin_pos_y, origin_pos_z: $origin_pos_z, origin_ori_x: $origin_ori_x, origin_ori_y: $origin_ori_y, origin_ori_z: $origin_ori_z, origin_ori_w: $origin_ori_w)
                    }
                """

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
        self.exited_agents = dict()
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

                    # print("Sent initialization message to new agent")
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

                    # Remove from exited agents if it exists
                    if sample.agent_id in self.exited_agents:
                        self.exited_agents.pop(sample.agent_id)
                    
                    self.update_to_agents = True
            elif sample.action == 'exit':
                # Agent Exited, remove from agents dictionary
                if sample.agent_id in self.agents:
                    print(f'Agent {sample.agent_id} exited the environment')
                    self.agents.pop(sample.agent_id)  # Pop from agents dictionary
                    self.exited_agents[sample.agent_id] = int(time.time())  # Add to exited agents dictionary
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

        # print('I will provide initialization.')
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
        exited_agents = self.exited_agents.copy()
        self.exited_agents.clear()
        return self.agents, exited_agents
    
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
        print(f"\nMy Agent ID is {self.my_id}")
        self.my_hash = hash_func(self.my_id)

        # Get IP Address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # This doesn't have to be reachable; it just has to be a valid address
        s.connect(("8.8.8.8", 80))
        self.my_ip = s.getsockname()[0]
        s.close()
        print(f"My IP address is {self.my_ip}\n")

        # Dictionary to store agents in the environment
        self.agents = dict()

        # Map and Map Metadata messages
        self.map_msg = OccupancyGrid()
        self.map_mod_msg = OccupancyGrid()
        self.map_md_msg = MapMetaData()

        self.lease_duration_ms = 30000
        qos_profile = DomainParticipantQos()
        qos_profile.lease_duration = duration(milliseconds=self.lease_duration_ms)

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = DomainParticipant(qos=qos_profile)
        self.subscriber = Subscriber(self.participant)
        self.publisher = Publisher(self.participant)

        # Create the topics needed
        self.entry_exit_topic = Topic(self.participant, 'EntryExitTopic', EntryExit)
        self.init_topic = Topic(self.participant, 'InitializationTopic', Initialization)

        # Create the DataWriters and DataReaders
        self.enter_exit_writer = DataWriter(self.publisher, self.entry_exit_topic, qos=reliable_qos)
        self.init_writer = DataWriter(self.publisher, self.init_topic, qos=reliable_qos)

        self.entry_exit_listener = EntryExitListener(self.participant, self.publisher, self.subscriber, self.my_id,
                                                     self.my_ip, self.my_hash, self.init_writer)
        self.init_listener = InitializationListener(self.my_id)

        # We will start the readers later when it is necessary
        self.enter_exit_reader = None
        self.init_reader = None

        # GraphQL server URL
        self.graphql_server = server_url

        self.last_time = int(time.time())

        # Clear any detected objects from the cache
        mutation = """
            mutation {
            clearDetectedObjects
            }
        """
        response = requests.post(
            self.graphql_server,
            json={'query': mutation},
            timeout=1
        )

        # Clear the subscribed agents cache
        mutation = """
            mutation($agentList: [Int!]!) {
            setAgentList(agent_list: $agentList)
            }
        """
        agent_list = [-1]
        response = requests.post(
            self.graphql_server,
            json={'query': mutation, 'variables': {'agentList': agent_list}},
            timeout=1
        )

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
        print("Starting Setup:")

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
                                                listener=self.entry_exit_listener, qos=reliable_qos)
        self.init_reader = DataReader(self.subscriber, self.init_topic, listener=self.init_listener, qos=reliable_qos)

        # Broadcast an entry message
        entry_message = EntryExit(int(self.my_id), AGENT_TYPE, 'enter', self.my_ip, int(time.time()))
        self.enter_exit_writer.write(entry_message)

        # Wait for the reference points to become available
        num_tries = 0
        while not self.init_listener.known_points_available() and num_tries < 10:
            print("    Reference Points not yet received (attempt {0}/10)".format(num_tries+1))
            time.sleep(1)
            if not self.init_listener.known_points_available():
                entry_message.timestamp = int(time.time())
                self.enter_exit_writer.write(entry_message)
                num_tries += 1

        if self.init_listener.known_points_available():
            print("    I am not the first agent, received reference points")

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
            print("    I am the first agent, my map will be the reference map")
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

        # Send confirmation message to entry_exit topic
        entry_message = EntryExit(int(self.my_id), AGENT_TYPE, 'initialized', self.my_ip, int(time.time()))
        self.enter_exit_writer.write(entry_message)

        print("Setup complete\n")

    def load_map(self):
        # Load the map from the user_map.json file
        with open('user_map.json', 'r') as f:
            map_data = json.load(f)

        map_data = map_data['data']['map'] 
        map_data_str = np.array(map_data['occupancy']).tobytes()

        # Send the map to ignite server
        response = requests.post(
            self.graphql_server,
            json={'query': MAP_MUTATION, 'variables': {'data': base64.b64encode(map_data_str).decode('utf-8')}},
            timeout=1
        )

        # Send the map metadata to ignite server
        response = requests.post(
            self.graphql_server,
            json={'query': MD_MUTATION, 'variables': {'resolution': map_data['resolution'], 'width': map_data['width'], 'height': map_data['height'], 'origin_pos_x': map_data['origin_x'], 'origin_pos_y': map_data['origin_y'], 'origin_pos_z': map_data['origin_z'], 'origin_ori_x': map_data['origin_orientation_x'], 'origin_ori_y': map_data['origin_orientation_y'], 'origin_ori_z': map_data['origin_orientation_z'], 'origin_ori_w': map_data['origin_orientation_w']}},   
            timeout=1
        )

        print("    Map loaded from user_map.json")

    def create_transform(self):
        """
        Determines the transform from my map to the reference map
        """
        print("    Creating Transform")

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

        # Now store the transform in the ignite server
        response =  requests.post(
                                self.graphql_server,
                                json={
                                    'query': TRANSFORM_MUTATION,
                                    'variables': {
                                        'R': self.R.flatten().tolist(),
                                        't': self.t.flatten().tolist(),
                                        'timestamp': int(time.time())
                                    }
                                },
                                timeout=1
                            )

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

        prev_agent_set = set()
        exited_agents = dict()
        while True:
            current_time = int(time.time())

            # Periodically perform some updates
            if current_time - self.last_time >= HEARTBEAT_PERIOD:  # FIXME different period...
                self.last_time = current_time
                update_to_active_agents = False

                # Check for new agents
                if self.entry_exit_listener.agent_update_available():
                    self.agents, newly_exited_agents = self.entry_exit_listener.get_agents()

                    if len(newly_exited_agents):
                        for agent_id in newly_exited_agents:
                            exited_agents[agent_id] = newly_exited_agents[agent_id]

                current_agents_list = list(self.agents.keys())

                

                for agent_id in current_agents_list:
                    if agent_id in exited_agents:
                        exited_agents.pop(agent_id)  # Remove from exited agents dictionary if reentered

                # Get agents from the GraphQL server
                heartbeat_agents = list(self.get_agents())

                new_agents = set(heartbeat_agents) - set(current_agents_list)
                for agent_id in new_agents:
                    if agent_id not in exited_agents:
                        self.agents[agent_id] = {
                            'agent_type': "unknown",
                            'ip_address': "unknown",
                            'hash': hash_func(str(agent_id)),
                            'timestamp': int(time.time())
                        }
                        update_to_active_agents = True

                # Check for dead agents that haven't exited gracefully
                dead_agents = prev_agent_set - set(heartbeat_agents)
                prev_agent_set = set(heartbeat_agents)
                for agent_id in dead_agents:
                    if agent_id in self.agents:
                        self.agents.pop(agent_id)
                        update_to_active_agents = True

                # Update the entry/exit listener with the new agents
                if update_to_active_agents:
                    self.entry_exit_listener.update_agents(agents=self.agents)

                self.update_agents(exited_agents=exited_agents)

            time.sleep(0.2)

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
        
    def update_agents(self, exited_agents=None):
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

        if exited_agents is not None:
            mutation = """
                mutation($agentList: [Int!]!) {
                setExitedAgentList(agent_list: $agentList)
                }
            """
            exited_agent_list = list(exited_agents.keys())

            response = requests.post(
                self.graphql_server,
                json={'query': mutation, 'variables': {'agentList': exited_agent_list}},
                timeout=1
            )

    def shutdown(self):
        print('\nSending exit message...\n')
        # Write exit message
        exit_message = EntryExit(int(self.my_id), AGENT_TYPE, 'exit', self.my_ip, int(time.time()))
        self.enter_exit_writer.write(exit_message)


if __name__ == '__main__':

    # Get the agent ID from the environment variable
    agent_id = os.getenv('AGENT_ID')
    if agent_id is None:
        raise ValueError("AGENT_ID environment variable not set")
    
    # Create an instance of the EntryExitCommunication class
    entry_exit_obj = EntryExitCommunication(agent_id, server_url='http://localhost:8000/graphql')

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
        print('Exiting...')
        exit(0)
