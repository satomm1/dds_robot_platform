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

from message_defs import Heartbeat, best_effort_qos

HEARTBEAT_PERIOD = 10    # seconds
AGENT_TYPE = 'human'


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

        # Get IP Address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # This doesn't have to be reachable; it just has to be a valid address
        s.connect(("8.8.8.8", 80))
        self.my_ip = s.getsockname()[0]
        s.close()
        print(f"My IP address is {self.my_ip}")

        self.lease_duration_ms = 30000
        qos_profile = DomainParticipantQos()
        qos_profile.lease_duration = duration(milliseconds=self.lease_duration_ms)

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = DomainParticipant(qos=qos_profile)
        self.publisher = Publisher(self.participant)

        # Create a Topic and DataWriter for the heartbeat message
        self.heartbeat_topic = Topic(self.participant, 'HeartbeatTopic', Heartbeat)
        self.heartbeat_writer = DataWriter(self.publisher, self.heartbeat_topic, qos=best_effort_qos)

    
    def run(self):
        """
        Publishes heartbeat messages at regular intervals.
        """
        # Start the heartbeat publishing loop
        while True:
            current_time = int(time.time())
            heartbeat_message = Heartbeat(self.agent_id, current_time, self.agent_type, self.my_ip, self.location_valid, 0.0, 0.0, 0.0, [])
            self.heartbeat_writer.write(heartbeat_message)
            print("Heartbeat Sent")
            time.sleep(HEARTBEAT_PERIOD)

    def shutdown(self):
        print('Heartbeat publisher stopped\n')
        

if __name__ == "__main__":
    # Create an instance of the HeartbeatPublisher and run it
    publisher = HeartbeatPublisher()

    def handle_signal(sig, frame):
        publisher.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    time.sleep(10)  # Wait for the participant to do entry and initialization
    try:
        publisher.run()
    except KeyboardInterrupt:
        print("Heartbeat publisher stopped.")
        exit(0)