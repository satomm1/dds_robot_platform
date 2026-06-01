# Jetson host service (port 8081)

The GUI Robot Startup panel talks to a small HTTP service on the **Jetson base machine** (not inside Docker) for Docker start/stop and power off. ROS launch remains on port **8080** inside the `ros_noetic` container (`startup_script.py`).

You do **not** need to clone `dds_robot_platform` on the Jetson. Copy one install script and run it.

## Install

From your development machine:

```bash
scp robot/jetson-host-install.sh YOUR_USER@JETSON_IP:~/
ssh YOUR_USER@JETSON_IP 'sudo bash ~/jetson-host-install.sh'
```

If you see `/usr/bin/env: 'bash\r': No such file or directory`, the file has Windows (CRLF) line endings. On the Jetson run `sed -i 's/\r$//' ~/jetson-host-install.sh` and run again, or re-`scp` from a checkout that uses LF for `*.sh` (see repo `.gitattributes`).

The installer writes:

| Path | Purpose |
|------|---------|
| `/opt/robot/host_service.py` | HTTP service (defaults baked in; home dir set at install) |
| `robot-host-service.service` | systemd unit (enabled on boot) |

Re-installing replaces `host_service.py` and restarts the service. To change Docker paths or the `docker run` command, edit `/opt/robot/host_service.py` on the Jetson and run `sudo systemctl restart robot-host-service`.

Verify:

```bash
curl -s http://127.0.0.1:8081/status
# {"host_service": true, "docker_running": false, "container": "ros_noetic"}
```

Open port **8081** from your operator PC if a firewall is enabled.

## Optional: download `host_service.py` from GitHub

```bash
sudo ROBOT_HOST_SERVICE_RAW_URL='https://raw.githubusercontent.com/YOUR_ORG/dds_robot_platform/main/robot/host_service.py' \
  bash ~/jetson-host-install.sh
```

The install script still substitutes `__JETSON_HOME__` in `DOCKER_RUN_CMD` after download.

## Endpoints

| GET path | Action |
|----------|--------|
| `/status` | JSON: host service up, whether `ros_noetic` is running |
| `/docker-start` | Start ROS container (detached `docker run`) |
| `/docker-stop` | Stop `ros_noetic` only |
| `/poweroff` | Stop **all** running containers, then `shutdown -h now` |

## Repo layout (developers)

| File | Role |
|------|------|
| `jetson-host-install.sh` | **Ship this to the Jetson** — self-contained installer |
| `host_service.py` | Source of truth; keep in sync with embedded copy in install script |
| `robot-host-service.service` | Reference systemd unit (also embedded in install script) |

After editing `host_service.py` in the repo, update the embedded heredoc in `jetson-host-install.sh` before deploying to robots.
