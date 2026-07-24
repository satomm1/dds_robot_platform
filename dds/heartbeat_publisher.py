from cyclonedds.topic import Topic
from cyclonedds.pub import Publisher, DataWriter

import time
import sys
import signal

from message_defs import Heartbeat, best_effort_qos

from dds_utils import (
    AgentIdError,
    create_domain_participant,
    dds_log,
    dispose_participant,
    get_ip,
    is_dds_verbose,
    require_agent_id_int,
)
from dds_utils.config import AGENT_TYPE, HEARTBEAT_PERIOD
from dds_utils.topics import HEARTBEAT_TOPIC


class HeartbeatPublisher:

    def __init__(self):
        """
        Initializes the HeartbeatPublisher.
        """

        try:
            self.agent_id = require_agent_id_int()
        except AgentIdError as exc:
            print(exc, file=sys.stderr)
            sys.exit(1)

        self.agent_type = AGENT_TYPE

        if self.agent_type == 'human':
            self.location_valid = False
            self.mcu_connected = False

        self.my_ip = get_ip()

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = create_domain_participant(domain_qos=True)
        self.publisher = Publisher(self.participant)

        # Create a Topic and DataWriter for the heartbeat message
        self.heartbeat_topic = Topic(self.participant, HEARTBEAT_TOPIC, Heartbeat)
        self.heartbeat_writer = DataWriter(self.publisher, self.heartbeat_topic, qos=best_effort_qos)


    def run(self):
        """
        Publishes heartbeat messages at regular intervals.
        """
        dds_log("hb_pub", f"ready (heartbeat every {HEARTBEAT_PERIOD}s)")
        # Start the heartbeat publishing loop
        while True:
            current_time = int(time.time())
            heartbeat_message = Heartbeat(
                self.agent_id,
                current_time,
                self.agent_type,
                self.my_ip,
                self.location_valid,
                0.0,
                0.0,
                0.0,
                [],
                self.mcu_connected,
            )
            self.heartbeat_writer.write(heartbeat_message)
            if is_dds_verbose():
                dds_log("hb_pub", "heartbeat sent")
            time.sleep(HEARTBEAT_PERIOD)

    def shutdown(self):
        dds_log("hb_pub", "stopped")
        self.heartbeat_writer = None
        self.publisher = None
        dispose_participant(self.participant)
        self.participant = None


if __name__ == "__main__":
    # Create an instance of the HeartbeatPublisher and run it
    publisher = HeartbeatPublisher()

    def handle_signal(sig, frame):
        publisher.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    time.sleep(11)  # Wait for the participant to do entry and initialization
    try:
        publisher.run()
    except KeyboardInterrupt:
        dds_log("hb_pub", "stopped")
        exit(0)
