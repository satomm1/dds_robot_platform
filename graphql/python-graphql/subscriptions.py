from ariadne import load_schema_from_path, make_executable_schema, gql, SubscriptionType
import json
import numpy as np
import asyncio
import struct

from confluent_kafka import Consumer, KafkaException

from ignite import ignite_client

def deserialize_key(key_bytes):
    return struct.unpack('>i', key_bytes)[0] if key_bytes is not None else None

subscription = SubscriptionType()

@subscription.source("robotPosition")
async def subscribe_robot_position(obj, info, robot_id: int):
    consumer = Consumer({
        'bootstrap.servers': 'broker:29092',
        'group.id': 'robotPosition',
        'auto.offset.reset': 'latest'
    })
    print("Connected to Kafka broker")

    consumer.subscribe(["robot_position"])
    print("Subscribed to topic")

    try:
        while True:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                await asyncio.sleep(0.1)
                continue

            if msg.error():
                if msg.error().code() == KafkaException._PARTITION_EOF:
                    continue
                else:
                    print(f"Kafka error: {msg.error()}")
                    break


            message = json.loads(msg.value().decode('utf-8'))
            message_robot_id = int(message["robot_id"])
            if message_robot_id == robot_id:
                yield {
                        "x": message["x"],
                        "y": message["y"],
                        "theta": message["theta"]
                    }

    finally:
        consumer.close()


@subscription.field("robotPosition")
def resolve_robot_position(message, info, robot_id):
    return message


@subscription.source("robotPositions")
async def subscribe_robot_position(obj, info):
    consumer = Consumer({
        'bootstrap.servers': 'broker:29092',
        'group.id': 'robotPosition',
        'auto.offset.reset': 'latest'
    })
    print("Connected to Kafka broker")

    consumer.subscribe(["robot_position"])
    print("Subscribed to topic")

    try:
        while True:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                await asyncio.sleep(0.1)
                continue

            if msg.error():
                if msg.error().code() == KafkaException._PARTITION_EOF:
                    continue
                else:
                    print(f"Kafka error: {msg.error()}")
                    break


            message = json.loads(msg.value().decode('utf-8'))
            message_robot_id = int(message["robot_id"])
            yield {
                    "id": message_robot_id,
                    "x": message["x"],
                    "y": message["y"],
                    "theta": message["theta"]
                }

    finally:
        consumer.close()


@subscription.field("robotPositions")
def resolve_robot_position(message, info):
    return message

@subscription.source("robotVideo")
async def subscribe_robot_position(obj, info, robot_id: int):
    consumer = Consumer({
        'bootstrap.servers': 'broker:29092',
        'group.id': 'robotVideo',
        'auto.offset.reset': 'latest'
    })
    print("Connected to Kafka broker")

    consumer.subscribe(["video"])
    print("Subscribed to topic")

    try:
        while True:
            msg = consumer.poll(timeout=1.0)
            if msg is None:
                await asyncio.sleep(0.1)
                continue

            if msg.error():
                if msg.error().code() == KafkaException._PARTITION_EOF:
                    continue
                else:
                    print(f"Kafka error: {msg.error()}")
                    break

            # Get key
            id = deserialize_key(msg.key())
            if id == robot_id:
                image_bytes = np.frombuffer(msg.value(), dtype=np.uint8).tolist()
                yield {
                    "robot_id": id,
                    "data": image_bytes
                }

    finally:
        consumer.close()

@subscription.field("robotVideo")
def resolve_robot_position(message, info, robot_id):
    return message