#!/bin/bash
pkill -f heartbeat_publisher.py
pkill -f goal_publisher.py
pkill -f location_subscriber.py
pkill -f data_subscriber.py
pkill -f entry_exit.py