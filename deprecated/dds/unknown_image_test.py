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
import json
import numpy as np
import cv2

@dataclass
class DataMessage(IdlStruct):
    message_type: str
    sending_agent: int
    timestamp: int
    data: str

class SelfDataListener(Listener):

    def __init__(self, my_id, topic_id):
        super().__init__()
        self.my_id = my_id
        self.topic_id = topic_id

    def on_data_available(self, reader):
        for sample in reader.read():
            
            sending_agent = sample.sending_agent
            if sending_agent == int(self.my_id):
                # Ignore messages from me
                continue

            message_type = sample.message_type
            timestamp = sample.timestamp
            data = json.loads(sample.data)

            # Process the message
            if message_type == "unknown_image":
                print(f"Received unknown image message from {sending_agent}")

                # Process the data
                data = json.loads(data)
                width = data['width']
                height = data['height']
                image = np.frombuffer(data['image'], dtype=np.uint8).reshape((height, width, 3))
                
                # Save the image
                image_path = os.path.join('images', f'unknown_image_{timestamp}.jpg')
                cv2.imwrite(image_path, image)
                

class UnknownImageReceiver:

    def __init__(self, my_id, robot_id):
        self.my_id = my_id
        self.robot_id = robot_id

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
        self.participant = DomainParticipant()
        self.subscriber = Subscriber(self.participant)
        self.publisher = Publisher(self.participant)

        # Create my data topic
        self.my_data_topic = Topic(self.participant, 'DataTopic' + str(self.my_id), DataMessage)
        self.target_data_topic = Topic(self.participant, 'DataTopic' + str(self.robot_id), DataMessage)

        self.data_listener = SelfDataListener(self.my_id, self.my_id)

        # Create a DataReader for my data topic
        self.data_reader = DataReader(self.subscriber, self.my_data_topic, listener=self.data_listener,  qos=self.reliable_data_qos)

        # Create a DataWriter for the target data topic
        self.data_writer = DataWriter(self.publisher, self.target_data_topic,  qos=self.reliable_data_qos)


    def send_query(self):
        data_message = DataMessage(message_type='send_unknown_images', sending_agent=self.my_id, timestamp=int(time.time()), data='{}')
        self.data_writer.write(data_message)
        print("Sent unknown image request")
                          
    def run(self):
        try:
            while True:
                time.sleep(0.1)
        except KeyboardInterrupt:
            print("Exiting...")    


if __name__ == '__main__':
    my_id = 101
    robot_id = 1

    receiver = UnknownImageReceiver(my_id, robot_id)
    
    time.sleep(2.5)
    receiver.send_query()
    receiver.run()