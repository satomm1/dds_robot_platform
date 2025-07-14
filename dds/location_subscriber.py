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

from message_defs import Location, best_effort_qos, get_ip

AGENTS_QUERY =  """
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
ROBOT_POSITION_MUTATION =   """
                                mutation($robot_id: Int!, $x: Float!, $y: Float!, $theta: Float!) {
                                    setRobotPosition(robot_id: $robot_id, x: $x, y: $y, theta: $theta)
                                }
                            """

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

        # GraphQL server URL
        if server_url is None:
            self.graphql_server =  f"http://{self.my_ip}:8000/graphql" 
        else:
            self.graphql_server = server_url

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
                x, y, theta = self.transform_point((sample.x, sample.y, sample.theta), forward=False)
                self.locations = (x, y, theta)
                ignite_data = {"x": x, "y": y, "theta": theta, "timestamp": sample.timestamp}
                ignite_data = json.dumps(ignite_data).encode('utf-8')

                # Update the robot position in Ignite
                agent_id = int(sample.agent_id)
                response =  requests.post(
                                self.graphql_server,
                                json={
                                    'query': ROBOT_POSITION_MUTATION,
                                    'variables': {
                                        'robot_id': agent_id,
                                        'x': x,
                                        'y': y,
                                        'theta': theta
                                    }
                                },
                                timeout=1
                            )

                # Write to InfluxDB if the write API is available                
                if self.influx_write_api is not None:
                    # Write the data to InfluxDB
                    point = Point("robot_position") \
                        .tag("robot_id", str(agent_id)) \
                        .field("x", x) \
                        .field("y", y) \
                        .field("theta", theta) \
                        .time(sample.timestamp, WritePrecision.S)
                    self.influx_write_api.write(bucket="first_bucket", org="eig", record=point)

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

        self.location_listeners = dict()
        self.location_readers = dict()

        for agent_id in self.subscribed_agents:
            print(f"Subscribed to agent {agent_id} location")
            new_location_topic = Topic(self.participant, 'LocationTopic' + str(agent_id), Location)
            self.location_listeners[agent_id] = LocationListener(self.my_id, self.my_ip, influx_write_api=self.influx_write_api)
            self.location_listeners[agent_id].update_transformation(self.R, self.t)
            self.location_readers[agent_id] = DataReader(self.subscriber, new_location_topic, listener=self.location_listeners[agent_id], qos=best_effort_qos)
    
    def run(self):
        while True:
            
            try:
                agents_to_subscribe = self.get_agents()
                new_agents = agents_to_subscribe - self.subscribed_agents
                old_agents = self.subscribed_agents - agents_to_subscribe

                for agent_id in new_agents:
                    print(f"    Subscribed to agent {agent_id} location")
                    new_location_topic = Topic(self.participant, 'LocationTopic' + str(agent_id), Location)
                    self.location_listeners[agent_id] = LocationListener(self.my_id, self.my_ip, influx_write_api=self.influx_write_api)
                    self.location_listeners[agent_id].update_transformation(self.R, self.t)
                    self.location_readers[agent_id] = DataReader(self.subscriber, new_location_topic, listener=self.location_listeners[agent_id], qos=best_effort_qos)

                for agent_id in old_agents:
                    print(f"    Unsubscribed from agent {agent_id} location")
                    self.location_readers[agent_id] = None
                    self.location_listeners[agent_id] = None
                    self.location_listeners.pop(agent_id)
                    self.location_readers.pop(agent_id)

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
        # print("location_subscriber got the transformation matrix!")

    def shutdown(self):
        print('Location subscriber stopped\n')
                            

if __name__ == '__main__':
    
    agent_id = os.getenv('AGENT_ID')
    if agent_id is None:
        raise ValueError("AGENT_ID environment variable not set")
    
    token = os.environ.get("INFLUXDB_TOKEN")
    if token is None:
        raise ValueError("INFLUXDB_TOKEN environment variable not set")
    org = "eig"
    url = "http://localhost:8086"
    write_client = influxdb_client.InfluxDBClient(url=url, token=token, org=org)

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
        print('Exiting...')
        exit(0)
    