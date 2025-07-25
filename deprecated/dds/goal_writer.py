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

ROBOT_GOALS_QUERY = """
                    query {
                        robotGoals {
                            id
                            x_goal
                            y_goal
                            theta_goal
                            goal_timestamp
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

@dataclass
class DataMessage(IdlStruct):
    message_type: str
    sending_agent: int
    timestamp: int
    data: str

class GoalWriter:
    def __init__(self, my_id, graphql_server):

        self.my_id = my_id

        self.graphql_server = graphql_server
        self.robot_goal_history = dict()

        # Create different policies for the DDS entities
        self.reliable_qos = Qos(
            Policy.Reliability.Reliable(max_blocking_time=duration(milliseconds=10)),
            Policy.Durability.TransientLocal,
            Policy.History.KeepLast(depth=1)
        )

        # Reliable data qos
        self.reliable_data_qos = Qos(
            Policy.Reliability.Reliable(max_blocking_time=duration(milliseconds=10)),
            Policy.Durability.TransientLocal,
            Policy.History.KeepLast(depth=10)
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

        self.R = None
        self.t = None

        # Get the transformation matrix from graphQL

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
                    print("Got the transformation matrix!")
                    break
                else:
                    time.sleep(1)

        # Now start the main loop
        while True:
            try:
                current_time = int(time.time())
                response = requests.post(self.graphql_server, json={'query': ROBOT_GOALS_QUERY}, timeout=1)
                if response.status_code == 200:
                    data = response.json()
                    
                    # print(current_time)
                    robot_goals = data.get('data', {}).get('robotGoals', [])
                    # print(robot_goals)

                    for robot_goal in robot_goals:
                        robot_goal_id = int(robot_goal['id'])
                        robot_goal_x = robot_goal['x_goal']
                        robot_goal_y = robot_goal['y_goal']
                        robot_goal_theta = robot_goal['theta_goal']
                        robot_goal_timestamp = robot_goal['goal_timestamp']

                        # Transform the goal to the reference map
                        robot_goal_x, robot_goal_y, robot_goal_theta = self.transform_point([robot_goal_x, robot_goal_y, robot_goal_theta], forward=True)

                        if robot_goal_id not in self.robot_goal_history:
                            # Store goal in history
                            self.robot_goal_history[robot_goal_id] = (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp)
                            if abs(current_time - robot_goal_timestamp) < 10: 
                                
                                # Send the goal to the robot
                                goal_dict = {"x": robot_goal_x, "y": robot_goal_y, "theta": robot_goal_theta}
                                command_message = DataMessage('goal', int(self.my_id), int(robot_goal_timestamp), json.dumps(goal_dict))
                                message_topic = Topic(self.participant, 'DataTopic' + str(robot_goal_id), DataMessage)
                                message_writer = DataWriter(self.publisher, message_topic, qos=self.reliable_data_qos)
                                message_writer.write(command_message)
                        elif self.robot_goal_history[robot_goal_id] != (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp):
                           
                            # Store goal in history
                            self.robot_goal_history[robot_goal_id] = (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp)
                            goal_dict = {"x": robot_goal_x, "y": robot_goal_y, "theta": robot_goal_theta}
                            command_message = DataMessage('goal', int(self.my_id), int(robot_goal_timestamp), json.dumps(goal_dict))
                            message_topic = Topic(self.participant, 'DataTopic' + str(robot_goal_id), DataMessage)
                            message_writer = DataWriter(self.publisher, message_topic, qos=self.reliable_data_qos)
                            
                            message_writer.write(command_message)
                            print("Received new goal *********************")
            except Exception as e:
                # print("No goals yet...", e)
                pass

            time.sleep(0.2)
                            
if __name__ == '__main__':

    goal_writer = GoalWriter(101, 'http://localhost:8000/graphql')

    try:
        goal_writer.run()
    except KeyboardInterrupt:
        print('Exiting...')
        exit(0)
    