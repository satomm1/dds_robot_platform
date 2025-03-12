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
import base64


@dataclass
class DataMessage(IdlStruct):
    message_type: str
    sending_agent: int
    timestamp: int
    data: str

class ImageDataListener(Listener):

    def __init__(self, my_id, topic_id):
        super().__init__()
        self.my_id = my_id
        self.topic_id = topic_id

        if not os.path.exists('new_data/images'):
            os.makedirs('new_data/images')
        if not os.path.exists('new_data/labels'):
            os.makedirs('new_data/labels')
        self.img_num = len(os.listdir('new_data/images'))

        self.previous_timestamp = None
        self.prev_objects = None
        
    def on_data_available(self, reader):
        for sample in reader.read():
            
            sending_agent = sample.sending_agent
            if sending_agent == int(self.my_id):
                # Ignore messages from me
                continue

            message_type = sample.message_type
            timestamp = sample.timestamp

            if self.previous_timestamp is not None and timestamp <= self.previous_timestamp:
                # Ignore old messages
                continue

            data = json.loads(sample.data)

            # Process the message
            if message_type == "unknown_image":
                print(f"Received unknown image message from {sending_agent}")

                # Process the data
                image_data = data['data']
                objects = data['objects']

                image_data_bytes = image_data.encode('utf-8')
                image_data_bytes = base64.b64decode(image_data_bytes)
                np_arr = np.frombuffer(image_data_bytes, dtype=np.uint8)
                img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
                img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

                # Get width and height of img
                height, width, _ = img.shape

                obj_labels = []
                for obj in objects:
                    # Process each object if needed
                    x1 = obj['x1']
                    y1 = obj['y1']
                    x2 = obj['x2']
                    y2 = obj['y2']

                    x = (x1 + x2) / 2 / width
                    y = (y1 + y2) / 2 / height
                    w = (x2 - x1) / width
                    h = (y2 - y1) / height

                    class_name = obj['class_name']
                    obj_labels.append((class_name, x, y, w, h))
                
                # Save the image
                image_path = os.path.join('new_data/images', f'new_image_{self.img_num}.jpg')
                label_path = os.path.join('new_data/labels', f'new_image_{self.img_num}.txt')

                cv2.imwrite(image_path, img)
                with open(label_path, 'w') as f:
                    for label in obj_labels:
                        class_name, x, y, w, h = label
                        f.write(f"{class_name} {x} {y} {w} {h}\n")

                print("Successfuly saved image number: ", self.img_num)

                self.img_num += 1
                

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

        self.data_listener = ImageDataListener(self.my_id, self.robot_id)

        # Create a DataReader for my data topic
        self.data_reader = DataReader(self.subscriber, self.target_data_topic, listener=self.data_listener,  qos=self.reliable_data_qos)

        print("Ready to receive unknown images...")
                          
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

    receiver.run()