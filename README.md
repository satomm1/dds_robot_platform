# DDS Robot Platform

## Overview
This repo contains the software for a human observer to connect to the mobile robot platform. Included in this repo is:
- `./dds`: The software for connecting to the other agents (i.e., mobile robots) via DDS
- `./gui`: The software for the web-based GUI for human interaction
- `./graphql`: The GraphQL implementation for API calls
- `./ignite`: Contains log files for the ignite database
- `./capture`: Central ingest service for robot image/video capture (standalone Docker stack; see [`capture/README.md`](capture/README.md))

## Getting Started

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/). Install it and ensure the Docker daemon is running.

Copy [`dds/dds_env.sh.example`](dds/dds_env.sh.example) to `dds/dds_env.sh` and set **`AGENT_ID`**, **`INFLUXDB_TOKEN`**, and any other operator variables. The compose stack and GUI read this file. The example file also sets **`CYCLONEDDS_URI`** to [`dds/cyclonedds.xml`](dds/cyclonedds.xml), which CycloneDDS uses for discovery.

Install the DDS Python environment on your host (WSL on Windows):

```
conda env create -f environment.yml
conda activate dds
```

`start_scripts.sh` activates the `dds` conda env automatically when `cyclonedds` is not already on `PATH`.

Before connecting to mobile robots, edit **`dds/cyclonedds.xml`** for your network:

- **Network interface** — set `<NetworkInterface name="…"/>` to the interface that reaches the robot fleet (run `ifconfig` or `ip link`; common names include `wlan0`, `wlp2s0`, `eth0`).
- **Peer addresses** — replace the placeholder `<Peer Address="…"/>` entries with the IP address of each robot (or other DDS participant) on that network.

> [!NOTE]
> I run this on a Windows machine with WSL (Windows Subsystem for Linux). Docker Compose and DDS commands should be run via WSL; the GUI can be run from Windows (desktop app) or from source.

## Local stack (Docker + host DDS)

The GraphQL API, InfluxDB, and Ignite run in Docker. **DDS Python scripts run on the host** (WSL on Windows), not in a container. The GraphQL service uses the **`ghcr.io/satomm1/matt_python`** image from [GitHub Container Registry](https://github.com/users/satomm1/packages).

1) Pull images and start the Docker services (from the repo root):
    ```
    docker compose pull
    docker compose up -d
    ```
    `docker compose up -d` alone also pulls missing images. This starts InfluxDB, Ignite, and the GraphQL API.

    **Alternatively**, use the GUI **Local Stack** panel (right sidebar): **Docker** → **Start** (runs `docker compose up -d` via WSL on Windows). Requires `compose.yaml` and `dds/dds_env.sh`.

2) Start the DDS scripts on the host (WSL on Windows):
    ```
    cd dds
    ./start_scripts.sh
    ```

3) When finished, stop the DDS scripts:
    ```
    cd dds
    ./stop_scripts.sh
    ```

    To tear down the Docker services:
    ```
    docker compose down
    ```
    Or **Docker** → **Stop** in the GUI.

### Verify DDS scripts are running

On the host (WSL on Windows):
```
pgrep -af python
```

You should see the six publisher/subscriber scripts (`entry_exit.py`, `heartbeat_publisher.py`, `goal_publisher.py`, `location_subscriber.py`, `data_subscriber.py`, `image_subscriber.py`).

When started from the GUI, script output is appended to `dds/dds_scripts.log`. When started manually in a terminal, output goes to that terminal.

For a throwaway container shell (same GHCR image as compose, useful for debugging imports):
```
./dds/run_dev_container.sh
```

### Maintainers: publish a new image version

When you rebuild `matt_python`, tag and push to GHCR, then bump the version in `compose.yaml` (`x-matt-python-image`):

```
docker tag matt_python:latest ghcr.io/satomm1/matt_python:1.1.0
docker tag matt_python:latest ghcr.io/satomm1/matt_python:latest
docker push ghcr.io/satomm1/matt_python:1.1.0
docker push ghcr.io/satomm1/matt_python:latest
```

Users on the pinned tag run `docker compose pull` before `docker compose up -d` to get the update.

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
5. **Backend:** The desktop app is **only the UI**. Start the Docker services and host DDS scripts so the GraphQL API is available (see [Local stack (Docker + host DDS)](#local-stack-docker--host-dds) above). The app expects **`http://localhost:8000/graphql`** unless the maintainer changed the URL at build time (`REACT_APP_GRAPHQL_HTTP_URL` in `gui`).

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
