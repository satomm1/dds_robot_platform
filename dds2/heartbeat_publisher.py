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

HEARTBEAT_PERIOD = 10    # seconds
AGENT_TYPE = 'human'

@dataclass
class Heartbeat(IdlStruct):
    """
    Represents a heartbeat message from an agent.

    Attributes:
        agent_id (int): The ID of the agent sending the heartbeat.
        timestamp (int): The timestamp of the heartbeat message.
        agent_type (str): The type of the agent sending the heartbeat.
        location_valid (bool): Indicates if the agent's location is valid.
        x (float): The x-coordinate of the agent's location.
        y (float): The y-coordinate of the agent's location.
        theta (float): The orientation of the agent.
        topics (sequence[str]): A sequence of topics the agent is publishing to
    """
    agent_id: int
    timestamp: int
    agent_type: str
    location_valid: bool
    x: float
    y: float
    theta: float
    topics: sequence[str]


class HeartbeatPublisher:

    def __init__(self):
        """
        Initializes the HeartbeatPublisher.
        """

        # Get the agent ID from the environment variable
        self.agent_id = os.getenv('AGENT_ID')
        if self.agent_id is None:
            raise ValueError("AGENT_ID environment variable not set")
        self.agent_id = int(self.agent_id)
        self.agent_type = AGENT_TYPE

        if self.agent_type == 'human':
            self.location_valid = False

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
        self.publisher = Publisher(self.participant)

        # Create a Topic and DataWriter for the heartbeat message
        self.heartbeat_topic = Topic(self.participant, 'HeartbeatTopic', Heartbeat)
        self.heartbeat_writer = DataWriter(self.publisher, self.heartbeat_topic, qos=self.best_effort_qos)

    
    def run(self):
        """
        Publishes heartbeat messages at regular intervals.
        """
        # Start the heartbeat publishing loop
        while True:
            current_time = int(time.time())
            heartbeat_message = Heartbeat(self.agent_id, current_time, self.agent_type, self.location_valid, 0.0, 0.0, 0.0, [])
            self.heartbeat_writer.write(heartbeat_message)
            print("Heartbeat Sent")
            time.sleep(HEARTBEAT_PERIOD)
        

if __name__ == "__main__":
    # Create an instance of the HeartbeatPublisher and run it
    publisher = HeartbeatPublisher()

    try:
        publisher.run()
    except KeyboardInterrupt:
        print("Heartbeat publisher stopped.")
        exit(0)