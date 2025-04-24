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
import json
import numpy as np
import signal
import requests

from message_defs import DataMessage, reliable_qos, get_ip

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

ROBOT_GOAL_MUTATION =   """
                            mutation($robot_id: Int!, $x_goal: Float!, $y_goal: Float!, $theta_goal: Float!, $goal_timestamp: Float!, $from_bot: Boolean) {
                                setRobotGoal(robot_id: $robot_id, x_goal: $x_goal, y_goal: $y_goal, theta_goal: $theta_goal, goal_timestamp: $goal_timestamp, from_bot: $from_bot)
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
                    """

class DataListener(Listener):

    def __init__(self, my_id, topic_id, graphql_server):
        super().__init__()
        self.my_id = my_id
        self.topic_id = topic_id
        self.graphql_server = graphql_server
        self.detected_object_num = 0
        self.object_dict = dict()

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

                print(f"Writing path data to Ignite for agent {sending_agent}")
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
                                        'robot_id': agent_id,
                                        'x_goal': x,
                                        'y_goal': y,
                                        'theta_goal': theta,
                                        'goal_timestamp': timestamp,
                                        'from_bot': True
                                    }
                                },
                                timeout=1
                            )


class DataSubscriber:
    def __init__(self, my_id, server_url=None):

        self.my_id = my_id

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
        self.participant = DomainParticipant()
        # self.participant = DomainParticipant(qos=qos_profile)
        self.subscriber = Subscriber(self.participant)

        self.data_listeners = dict()
        self.data_readers = dict()

        for agent_id in self.subscribed_agents:
            print(f"Subscribed to agent {agent_id} data")
            new_data_topic = Topic(self.participant, 'DataTopic' + str(agent_id), DataMessage)
            self.data_listeners[agent_id] = DataListener(self.my_id, agent_id, self.graphql_server)
            self.data_listeners[agent_id].update_transformation(self.R, self.t)
            self.data_readers[agent_id] = DataReader(self.subscriber, new_data_topic, listener=self.data_listeners[agent_id], qos=reliable_qos)

    def run(self):
        while True:

            try:            
                agents_to_subscribe = self.get_agents()
                new_agents = agents_to_subscribe - self.subscribed_agents
                old_agents = self.subscribed_agents - agents_to_subscribe

                for agent_id in new_agents:
                    if int(agent_id) == int(self.my_id):
                        continue

                    print(f"    Subscribed to agent {agent_id} data")
                    new_data_topic = Topic(self.participant, 'DataTopic' + str(agent_id), DataMessage)
                    self.data_listeners[agent_id] = DataListener(self.my_id, agent_id, self.graphql_server)
                    self.data_listeners[agent_id].update_transformation(self.R, self.t)
                    self.data_readers[agent_id] = DataReader(self.subscriber, new_data_topic, listener=self.data_listeners[agent_id], qos=reliable_qos)


                for agent_id in old_agents:
                    print(f"    Unsubscribed from agent {agent_id} data")
                    self.data_listeners[agent_id] = None
                    self.data_readers[agent_id] = None
                    self.data_listeners.pop(agent_id)
                    self.data_readers.pop(agent_id)

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
        # print("data_subscriber got the transformation matrix!")

    def shutdown(self):
        print('Data subscriber stopped\n')
                            
if __name__ == '__main__':

    def handle_signal(sig, frame):
        data_sub.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    time.sleep(10)  # Wait for the participant to do entry and initialization
    # Create an instance of the DataSubscriber
    agent_id = os.getenv('AGENT_ID')
    if agent_id is None:
        raise ValueError("AGENT_ID environment variable not set")
    data_sub = DataSubscriber(agent_id)

    def handle_signal(sig, frame):
        data_sub.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    try:
        data_sub.run()
    except KeyboardInterrupt:
        print('Exiting...')
        exit(0)
    