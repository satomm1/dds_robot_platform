# DDS Robot Platform

## Overview
This repo contains the software for a human observer to connect to the mobile robot platform. Included in this repo is:
- `./dds`: The software for connecting to the other agents (i.e., mobile robots) via DDS
- `./gui`: The software for the web-based GUI for human interaction
- `./graphql`: The GraphQL implementation for API calls
- `./ignite`: Contains log files for the ignite database

## Getting Started
To run DDS, you need [Docker Desktop](https://www.docker.com/products/docker-desktop/). Please follow the instructions to download and install Docker.

You will also need a conda interpreter. I recommend [miniconda](https://www.anaconda.com/docs/getting-started/miniconda/main). 

> [!NOTE]
> I run this on a Windows machine with WSL (Windows Subsystem for Linux). The Docker and dds code should be run via WSL, the GUI should be run from Windows terminal.

## DDS
1) Download my Docker python environment from: https://drive.google.com/drive/folders/1emeEoJrZxV4Nn6ktKUAyXbSTj0LjnlfB?usp=drive_link.

    Load the docker image:
    ```
    docker load < matt_python_latest.tar.gz
    ```

2) Prepare the conda environment:
    ```
    conda env create -f environment.yml
    ```

3) Open 3 Terminals:
    - Terminal 1: Start docker
        ```
        docker compose up -d
        ```
    - Terminal 2: Navigate to dds directory and activate dds environment
        ```
        cd dds
        conda activate dds
        ```
        Run the dds code:
        ```
        . start_scripts.sh
        ```

    - Terminal 3: Navigate to dds directory and activate dds environment
        ```
        cd dds
        conda activate dds
        ```
        Terminate the dds code:
        ```
        . stop_scripts.sh
        ```
        
## GUI

1) Install Node.js from https://nodejs.org/en

    Verify installation by opening the commmand line and running:
    ```
    node -v
    npm -v
    ```

2) Navigate to the `gui` directory and install dependencies:
    ```
    cd gui
    ```
    ```
    npm install
    ```

3) Start the server:
    ```
    npm start
    ```

    Alternatively, to run a production build:
    ```
    npm run build
    npm install -g serve
    serve -s build
    ```

## Multi-robot coordinated goals (GUI and DDS)

The GUI mode **Multi-robot plan** stages one goal pose per fleet robot and submits them through GraphQL (`setMultiRobotGoalPlan`). The orchestrator `goal_publisher.py` reads the active plan, transforms poses into the shared reference map frame, and fans out DDS `DataMessage` samples with `message_type` `multi_robot_goal` to each robot’s `DataTopic`, matching [mattbot_dds](https://github.com/satomm1/mattbot_dds) `dds_data_publisher` behavior so robots receive the same payload shape as from ROS `MultiRobotGoalPlan` on `/multi_robot_goal_plan`.

**Operations:** If you also publish fleet goals from ROS (for example `path_planning` `publish_multi_robot_goal_plan.py` plus `dds_data_publisher` on the same orchestrator), use **only one path per dispatch**. Sending the same coordinated move through both ROS and the GUI can duplicate `multi_robot_goal` traffic on DDS and confuse downstream planners.
