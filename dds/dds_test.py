import time
from cyclonedds.domain import DomainParticipant
from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber, DataReader
from cyclonedds.pub import Publisher, DataWriter
from cyclonedds.util import duration
from cyclonedds.idl import IdlStruct
from cyclonedds.idl.types import sequence
from cyclonedds.core import Qos, Policy, Listener
from cyclonedds.builtin import BuiltinDataReader, BuiltinTopicDcpsParticipant
from dataclasses import dataclass

# Define the topic type
@dataclass
class HelloWorld(IdlStruct):
    message: str

# Create a DomainParticipant
participant = DomainParticipant()

# Create a Publisher
publisher = Publisher(participant)

# Create a Topic
topic = Topic(participant, "HelloWorld", HelloWorld)

# Create a DataWriter
writer = DataWriter(publisher, topic)

# Create a HelloWorld sample
sample = HelloWorld("Hello, World!")

# Publish the sample forever with a one-second delay
while True:
    # Write the sample
    writer.write(sample)

    # Wait for one second
    time.sleep(1)

# Cleanup (this code will never be reached)
del writer
del topic
del publisher
del participant