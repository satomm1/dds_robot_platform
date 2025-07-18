#!/bin/bash

python3 entry_exit.py &
python3 heartbeat_publisher.py &
python3 heartbeat_subscriber.py &
python3 goal_publisher.py &
python3 location_subscriber.py &
python3 data_subscriber.py &
python3 image_subscriber.py &
wait

