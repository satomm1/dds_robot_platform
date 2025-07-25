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

import json
import requests
import numpy as np
import signal
import os

from message_defs import DataMessage, reliable_qos, get_ip

ROBOT_GOALS_QUERY = """
                    query {
                        robotGoals {
                            id
                            x_goal
                            y_goal
                            theta_goal
                            goal_timestamp
                            goal_valid
                        }
                    }
                    """

ROBOT_INITIAL_POSITIONS_QUERY = """
                            query {
                                robotInitialPositions {
                                    id
                                    x_init
                                    y_init
                                    theta_init
                                    init_timestamp
                                }
                            }
                            """

TRANSFORMATION_MATRIX_QUERY = """
                            query {
                                transform {
                                    R
                                    t
                                    timestamp
                                }
                            }
                            """

class GoalWriter:
    def __init__(self, my_id, server_url=None):

        self.my_id = my_id

        # GraphQL server URL
        self.my_ip = get_ip()
        if server_url is None:
            self.graphql_server =  f"http://{self.my_ip}:8000/graphql" 
        else:
            self.graphql_server = server_url

        self.robot_goal_history = dict()
        self.robot_init_history = dict()

        self.lease_duration_ms = 30000
        qos_profile = DomainParticipantQos()
        qos_profile.lease_duration = duration(milliseconds=self.lease_duration_ms)

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = DomainParticipant(qos=qos_profile)
        self.subscriber = Subscriber(self.participant)
        self.publisher = Publisher(self.participant)

        self.R = None
        self.t = None


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

        # First make sure we have the transformation matrix
        while self.R is None:
            response = requests.post(self.graphql_server, json={'query': TRANSFORMATION_MATRIX_QUERY}, timeout=1)
            if response.status_code == 200:
                data = response.json()
                transform = data.get('data', {}).get('transform', {})
                timestamp = transform.get('timestamp', 0)
                if time.time() - timestamp > 10:
                    continue
                R = transform.get('R', [])
                t = transform.get('t', [])
                if len(R) == 4 and len(t) == 2:
                    self.R = np.array(R).reshape((2, 2))
                    self.t = np.array(t)
                    # print("Goal publisher got the transformation matrix!")
                    break
                else:
                    time.sleep(1)

        # Now start the main loop
        while True:
            try:
                current_time = int(time.time())

                # Query for any robot goals
                response = requests.post(self.graphql_server, json={'query': ROBOT_GOALS_QUERY}, timeout=1)
                if response.status_code == 200:
                    data = response.json()
                    
                    # Get the robot goals from the response
                    robot_goals = data.get('data', {}).get('robotGoals', [])

                    for robot_goal in robot_goals:
                        robot_goal_id = int(robot_goal['id'])
                        robot_goal_x = robot_goal['x_goal']
                        robot_goal_y = robot_goal['y_goal']
                        robot_goal_theta = robot_goal['theta_goal']
                        robot_goal_timestamp = robot_goal['goal_timestamp']
                        robot_goal_valid = robot_goal.get('goal_valid', True)

                        if not robot_goal_valid:
                            # Skip invalid goals
                            continue

                        # Transform the goal to the reference map
                        robot_goal_x, robot_goal_y, robot_goal_theta = self.transform_point([robot_goal_x, robot_goal_y, robot_goal_theta], forward=True)

                        if robot_goal_id not in self.robot_goal_history:
                            # Store goal in history
                            self.robot_goal_history[robot_goal_id] = (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp)

                            # Check if the goal is recent
                            if abs(current_time - robot_goal_timestamp) < 10: 
                                
                                # Send the goal to the robot
                                goal_dict = {"x": robot_goal_x, "y": robot_goal_y, "theta": robot_goal_theta}
                                command_message = DataMessage('goal', int(self.my_id), int(robot_goal_timestamp), json.dumps(goal_dict))
                                message_topic = Topic(self.participant, 'DataTopic' + str(robot_goal_id), DataMessage)
                                message_writer = DataWriter(self.publisher, message_topic, qos=reliable_qos)
                                message_writer.write(command_message)
                        elif self.robot_goal_history[robot_goal_id] != (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp):
                           
                            # Store goal in history
                            self.robot_goal_history[robot_goal_id] = (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp)
                            goal_dict = {"x": robot_goal_x, "y": robot_goal_y, "theta": robot_goal_theta}
                            command_message = DataMessage('goal', int(self.my_id), int(robot_goal_timestamp), json.dumps(goal_dict))
                            message_topic = Topic(self.participant, 'DataTopic' + str(robot_goal_id), DataMessage)
                            message_writer = DataWriter(self.publisher, message_topic, qos=reliable_qos)
                            
                            message_writer.write(command_message)
                            print("Received new goal *********************")


                # Query for any robot initial positions
                response = requests.post(self.graphql_server, json={'query': ROBOT_INITIAL_POSITIONS_QUERY}, timeout=1)
                if response.status_code == 200:
                    data = response.json()
                    
                    # Get the robot goals from the response
                    robot_init = data.get('data', {}).get('robotInitialPositions', [])

                    for robot in robot_init:
                        robot_id = int(robot['id'])
                        robot_x = robot['x_init']
                        robot_y = robot['y_init']
                        robot_theta = robot['theta_init']
                        robot_timestamp = robot['init_timestamp']

                        # Transform the initial position to the reference map
                        robot_x, robot_y, robot_theta = self.transform_point([robot_x, robot_y, robot_theta], forward=True)

                        if robot_id not in self.robot_init_history:
                            # Store initial position in history
                            self.robot_init_history[robot_id] = (robot_x, robot_y, robot_theta, robot_timestamp)

                            # Check if the initial position is recent
                            if abs(current_time - robot_timestamp) < 10:

                                # Send the initial position to the robot
                                init_dict = {"x": robot_x, "y": robot_y, "theta": robot_theta}
                                command_message = DataMessage('position_init', int(self.my_id), int(robot_timestamp), json.dumps(init_dict))
                                message_topic = Topic(self.participant, 'DataTopic' + str(robot_id), DataMessage)
                                message_writer = DataWriter(self.publisher, message_topic, qos=reliable_qos)
                                message_writer.write(command_message)
                        elif self.robot_init_history[robot_id] != (robot_x, robot_y, robot_theta, robot_timestamp):
                            # Store initial position in history
                            self.robot_init_history[robot_id] = (robot_x, robot_y, robot_theta, robot_timestamp)
                            init_dict = {"x": robot_x, "y": robot_y, "theta": robot_theta}
                            command_message = DataMessage('position_init', int(self.my_id), int(robot_timestamp), json.dumps(init_dict))
                            message_topic = Topic(self.participant, 'DataTopic' + str(robot_id), DataMessage)
                            message_writer = DataWriter(self.publisher, message_topic, qos=reliable_qos)
                            
                            message_writer.write(command_message)
                            print("Received new initial position *********************")

            except Exception as e:
                # print("No goals yet...", e)
                pass

            time.sleep(0.2)

    def shutdown(self):
        print('Goal publisher stopped\n')
                            
if __name__ == '__main__':

    agent_id = os.getenv('AGENT_ID')
    if agent_id is None:
        raise ValueError("AGENT_ID environment variable not set")

    goal_writer = GoalWriter(agent_id)

    def handle_signal(sig, frame):
        goal_writer.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    time.sleep(10)  # Wait for the participant to do entry and initialization
    try:
        goal_writer.run()
    except KeyboardInterrupt:
        print('Exiting...')
        exit(0)
    