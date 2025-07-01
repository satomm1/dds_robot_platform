#!/bin/bash

python3 user_entry_exit_ignite.py &
python3 data_subscriber.py &
python3 location_subscriber.py &
python3 goal_writer.py &
wait
