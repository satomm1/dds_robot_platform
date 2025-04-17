from cyclonedds.util import duration
from cyclonedds.idl import IdlStruct
from cyclonedds.idl.types import sequence
from cyclonedds.core import Qos, Policy

from dataclasses import dataclass

import socket

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
    ip_address: str
    location_valid: bool
    x: float
    y: float
    theta: float
    topics: sequence[str]

@dataclass
class EntryExit(IdlStruct):
    agent_id: int
    agent_type: str
    action: str
    ip_address: str
    timestamp: int

@dataclass
class Initialization(IdlStruct):
    """
    Represents the initialization parameters for the agent entry/exit system.

    Attributes:
        target_agent (int): The ID of the target agent.
        agents (str): A json dict of all the agents that the sending_agent is aware of.
        known_points (str): 
    """
    target_agent: int
    sending_agent: int
    agents: str
    known_points: str

@dataclass
class DataMessage(IdlStruct):
    message_type: str
    sending_agent: int
    timestamp: int
    data: str

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


# Create different policies for the DDS entities
reliable_qos = Qos(
    Policy.Reliability.Reliable(max_blocking_time=duration(milliseconds=10)),
    Policy.Durability.TransientLocal,
    Policy.History.KeepLast(depth=1)
)

best_effort_qos = Qos(
    Policy.Reliability.BestEffort,
    Policy.Durability.Volatile,
    Policy.Liveliness.ManualByParticipant(lease_duration=duration(milliseconds=30000))
)

def get_ip():
    # Get IP Address
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    # This doesn't have to be reachable; it just has to be a valid address
    s.connect(("8.8.8.8", 80))
    my_ip = s.getsockname()[0]
    s.close()
    return my_ip