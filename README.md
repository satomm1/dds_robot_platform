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

    Copy [`dds/dds_env.sh.example`](dds/dds_env.sh.example) to `dds/dds_env.sh` and set **`AGENT_ID`**, **`INFLUXDB_TOKEN`**, and any other operator variables (`start_scripts.sh` and the GUI read this file).

3) Open 3 Terminals:
    - Terminal 1: Start docker and the relevant containers (from the main `dds_robot_platform` directory):
        ```
        docker compose up -d
        ```
    - Terminal 2: Navigate to `dds` directory:
        ```
        cd dds
        ```
        Run the DDS code:
        ```
        ./start_scripts.sh
        ```

    - Terminal 3: Navigate to `dds` directory:
        ```
        cd dds
        ```
        After you are done using the GUI, terminate the DDS code:
        ```
        ./stop_scripts.sh
        ```
        
## GUI

The GUI can be used either as a **pre-built desktop app** (no Node.js) or from **source** (for development).

### Desktop application (installers — for end users)

These builds are produced automatically by GitHub Actions. You only need a normal GitHub login to download artifacts from a **public** repository (or access to the repo if it is private).

1. Go to `https://github.com/satomm1/dds_robot_platform/actions/`
2. Click the most recent successful workflow runs.
3. At the bottom of the run page, under **Artifacts**, download **one** ZIP for your system (**NOTE: You must be logged in to GitHub to download the installers**):
   - **Windows:** `gui-installer-windows-latest` — unzip, then run **`DDS Robot GUI Setup … .exe`** and complete the installer. Launch **DDS Robot GUI** from the Start menu. If Windows SmartScreen appears (unsigned build), choose **More info** → **Run anyway** if you trust this source.
   - **macOS:** `gui-installer-macos-latest` — unzip, open the **`.dmg`**, drag **DDS Robot GUI** into Applications. First launch may require **right‑click → Open** (unsigned app), or allowing the app under **System Settings → Privacy & Security**.
   - **Linux:** `gui-installer-ubuntu-latest` — unzip the **`.AppImage`**, make it executable (`chmod +x "DDS Robot GUI"*.AppImage` or similar), then run it. Some distributions need **FUSE** / **libfuse2** for AppImages; install your distro’s fuse package if the app will not start.
4. You should now have an executable to run on your machine to start and run the GUI!
5. **Backend:** The desktop app is **only the UI**. Start the rest of the stack (Docker/GraphQL, DDS) so the GraphQL API is available (see the DDS section above). The app expects **`http://localhost:8000/graphql`** unless the maintainer changed the URL at build time (`REACT_APP_GRAPHQL_HTTP_URL` in `gui`).

### Run from source (developers)

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
