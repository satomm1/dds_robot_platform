#!/bin/bash

python3 entry_exit.py &
python3 heartbeat_publisher.py &
python3 goal_publisher.py &
python3 location_subscriber.py &
wait

