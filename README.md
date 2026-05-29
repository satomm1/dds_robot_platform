# DDS Robot Platform

## Overview
This repo contains the software for a human observer to connect to the mobile robot platform. Included in this repo is:
- `./dds`: The software for connecting to the other agents (i.e., mobile robots) via DDS
- `./gui`: The software for the web-based GUI for human interaction
- `./graphql`: The GraphQL implementation for API calls
- `./ignite`: Contains log files for the ignite database

## Getting Started

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/). Install it and ensure the Docker daemon is running.

Copy [`dds/dds_env.sh.example`](dds/dds_env.sh.example) to `dds/dds_env.sh` and set **`AGENT_ID`**, **`INFLUXDB_TOKEN`**, and any other operator variables. The compose stack, DDS container, and GUI read this file.

> [!NOTE]
> I run this on a Windows machine with WSL (Windows Subsystem for Linux). Docker Compose and DDS commands should be run via WSL; the GUI can be run from Windows (desktop app) or from source.

## DDS (Docker)

The local stack runs entirely in Docker. The `dds` service uses the `matt_python:latest` image and mounts `./dds` into the container; DDS scripts are started and stopped on demand (they do not auto-run when the container is created).

1) Download the Docker Python environment from: https://drive.google.com/drive/folders/1emeEoJrZxV4Nn6ktKUAyXbSTj0LjnlfB?usp=drive_link

    Load the image:
    ```
    docker load < matt_python_latest.tar.gz
    ```

2) Start the stack (from the repo root):
    ```
    docker compose up -d
    ```
    This starts InfluxDB, Ignite, the GraphQL API, and the idle `dds` container.

    **Alternatively**, use the GUI **Local Stack** panel (right sidebar): **Docker** → **Start** (runs `docker compose up -d` via WSL on Windows). Requires `compose.yaml` and `dds/dds_env.sh`.

3) Start the DDS scripts (after Docker is up):
    ```
    docker exec -d dds ./start_scripts.sh
    ```

    **Alternatively**, in the GUI **Local Stack** panel: set the path to the `dds_robot_platform` repo root (auto-checked on startup), start **Docker**, then **DDS** → **Start**. The DDS Start button stays disabled until Docker is running.

4) When finished, stop the DDS scripts:
    ```
    docker exec dds ./stop_scripts.sh
    ```
    Or click **DDS** → **Stop** in the GUI **Local Stack** panel.

    To tear down the whole stack:
    ```
    docker compose down
    ```
    Or **Docker** → **Stop** in the GUI.

### Verify DDS scripts are running

Inside the `dds` container:
```
docker exec dds bash -lc "pgrep -af python"
```

You should see the six publisher/subscriber scripts (`entry_exit.py`, `heartbeat_publisher.py`, `goal_publisher.py`, `location_subscriber.py`, `data_subscriber.py`, `image_subscriber.py`).

### Optional: run DDS on the host with conda

If you prefer not to use the `dds` container (for example, local development without rebuilding the image), you can run the scripts directly on the host:

1. Install [miniconda](https://www.anaconda.com/docs/getting-started/miniconda/main) and create the environment:
    ```
    conda env create -f environment.yml
    conda activate dds
    ```

2. From the `dds` directory:
    ```
    ./start_scripts.sh
    ```
    Stop with `./stop_scripts.sh`.

    `start_scripts.sh` activates the `dds` conda env automatically when `cyclonedds` is not already on `PATH`.

For a throwaway container shell (same image as compose, useful for debugging imports):
```
./dds/run_dev_container.sh
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
5. **Backend:** The desktop app is **only the UI**. Start the Docker stack and DDS scripts so the GraphQL API is available (see [DDS (Docker)](#dds-docker) above). The app expects **`http://localhost:8000/graphql`** unless the maintainer changed the URL at build time (`REACT_APP_GRAPHQL_HTTP_URL` in `gui`).

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
