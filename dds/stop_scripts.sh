#!/bin/bash
pkill -f heartbeat_publisher.py
pkill -f heartbeat_subscriber.py
pkill -f goal_publisher.py
pkill -f location_subscriber.py
pkill -f data_subscriber.py
pkill -f image_subscriber.py
pkill -f entry_exit.py