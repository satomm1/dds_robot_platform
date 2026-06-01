#!/usr/bin/env bash
# Standalone Jetson host service installer (no git clone required).
#
# Copy to the Jetson and run:
#   scp robot/jetson-host-install.sh user@jetson:~/
#   ssh user@jetson 'sudo bash ~/jetson-host-install.sh'
#
# Optional: download host_service.py from GitHub instead of the embedded copy:
#   sudo ROBOT_HOST_SERVICE_RAW_URL='https://raw.githubusercontent.com/USER/REPO/main/robot/host_service.py' \
#     bash ~/jetson-host-install.sh
#
# After install: curl http://localhost:8081/status

set -euo pipefail

INSTALL_DIR="/opt/robot"
SERVICE_NAME="robot-host-service.service"
HOST_SERVICE_PY="${INSTALL_DIR}/host_service.py"

# Override to wget host_service.py (must be raw URL to the .py file)
HOST_SERVICE_RAW_URL="${ROBOT_HOST_SERVICE_RAW_URL:-}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Warning: docker not found in PATH. Install Docker before using /docker-start." >&2
fi

# Home directory for volume paths in ROBOT_DOCKER_RUN_CMD (~ does not expand in systemd env)
if [[ -n "${SUDO_USER:-}" ]] && [[ "${SUDO_USER}" != "root" ]]; then
  JETSON_HOME="$(getent passwd "${SUDO_USER}" | cut -d: -f6)"
else
  JETSON_HOME="${HOME}"
fi
JETSON_HOME="${JETSON_HOME:-/root}"

mkdir -p "${INSTALL_DIR}"

substitute_jetson_home_in_py() {
  sed -i "s|__JETSON_HOME__|${JETSON_HOME}|g" "${HOST_SERVICE_PY}"
}

install_host_service_py() {
  if [[ -n "${HOST_SERVICE_RAW_URL}" ]]; then
    echo "Downloading host_service.py from ${HOST_SERVICE_RAW_URL}"
    if command -v wget >/dev/null 2>&1; then
      wget -q -O "${HOST_SERVICE_PY}.tmp" "${HOST_SERVICE_RAW_URL}"
    elif command -v curl >/dev/null 2>&1; then
      curl -fsSL -o "${HOST_SERVICE_PY}.tmp" "${HOST_SERVICE_RAW_URL}"
    else
      echo "wget or curl required for ROBOT_HOST_SERVICE_RAW_URL" >&2
      exit 1
    fi
    mv "${HOST_SERVICE_PY}.tmp" "${HOST_SERVICE_PY}"
    chmod 0755 "${HOST_SERVICE_PY}"
    substitute_jetson_home_in_py
    return
  fi

  echo "Installing embedded host_service.py to ${HOST_SERVICE_PY}"
  cat > "${HOST_SERVICE_PY}" << 'HOST_SERVICE_PY_EOF'
#!/usr/bin/env python3
"""HTTP host service on port 8081. Runs on the Jetson base machine (not inside Docker).

Endpoints: GET /status, /docker-start, /docker-stop, /poweroff
GUI polls GET /status; Docker start/stop and power off go through this service.
"""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import subprocess
import time
from urllib.parse import urlparse

HOST_SERVICE_PORT = 8081
DOCKER_CONTAINER = "ros_noetic"
DOCKER_STOP_TIMEOUT_SEC = 30

DOCKER_RUN_CMD = (
    "docker run -d --runtime nvidia --network=host "
    "-v __JETSON_HOME__/workspaces/catkin_ws:/workspace/catkin_ws "
    "-v __JETSON_HOME__/gemini_api:/gemini_code "
    "-v /dev/bus/usb:/dev/bus/usb "
    "-v /dev/video0:/dev/video0 -v /dev/video1:/dev/video1 "
    "--device=/dev/ttyUSB0 --device=/dev/spidev0.0 "
    "--rm --privileged --pid=host --name ros_noetic ml_ros:latest "
    "bash -lc 'python3 /workspace/catkin_ws/src/startup_script.py & exec tail -f /dev/null'"
)

HOST_POWEROFF_CMD = (
    "nohup bash -c '/usr/sbin/shutdown -h now' </dev/null >/dev/null 2>&1 &"
)


def _run_cmd(cmd, timeout=None, shell=False):
    try:
        proc = subprocess.run(
            cmd,
            shell=shell,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode == 0, (proc.stdout or "").strip(), (proc.stderr or "").strip()
    except subprocess.TimeoutExpired:
        return False, "", f"Command timed out after {timeout}s"
    except OSError as exc:
        return False, "", str(exc)


def _container_running(name):
    ok, stdout, _ = _run_cmd(
        ["docker", "inspect", "-f", "{{.State.Running}}", name],
        timeout=10,
    )
    return ok and stdout.lower() == "true"


def _list_running_container_ids():
    ok, stdout, stderr = _run_cmd(["docker", "ps", "-q"], timeout=10)
    if not ok:
        return [], stderr or "docker ps failed"
    ids = [line.strip() for line in stdout.splitlines() if line.strip()]
    return ids, ""


def _stop_container(container_id, timeout_sec):
    ok, _, stderr = _run_cmd(
        ["docker", "stop", "-t", str(timeout_sec), container_id],
        timeout=timeout_sec + 5,
    )
    if ok:
        return True, ""
    kill_ok, _, kill_err = _run_cmd(["docker", "kill", container_id], timeout=15)
    if kill_ok:
        return True, f"kill fallback for {container_id}"
    return False, stderr or kill_err or f"failed to stop {container_id}"


def _stop_all_containers():
    ids, err = _list_running_container_ids()
    if err:
        return False, [], [{"error": err}]

    if not ids:
        return True, [], []

    stopped = []
    errors = []
    for cid in ids:
        ok, note = _stop_container(cid, DOCKER_STOP_TIMEOUT_SEC)
        if ok:
            stopped.append({"id": cid, "note": note or "stopped"})
        else:
            errors.append({"id": cid, "error": note})

    return len(errors) == 0, stopped, errors


def _poweroff_summary():
    all_ok, stopped, errors = _stop_all_containers()
    if stopped:
        message = f"Stopped {len(stopped)} container(s); host shutdown scheduled."
    elif not errors:
        message = "No containers running; host shutdown scheduled."
    elif not all_ok:
        message = "Some containers could not be stopped; host shutdown scheduled anyway."
    else:
        message = "Host shutdown scheduled."

    return {
        "ok": True,
        "message": message,
        "all_stopped": all_ok,
        "containers_stopped": stopped,
        "errors": errors,
    }


def _docker_start():
    if _container_running(DOCKER_CONTAINER):
        return True, f"Container {DOCKER_CONTAINER} is already running."

    if not DOCKER_RUN_CMD:
        return False, "ROBOT_DOCKER_RUN_CMD is not configured."

    ok, stdout, stderr = _run_cmd(DOCKER_RUN_CMD, shell=True, timeout=120)
    if not ok:
        detail = stderr or stdout or "docker run failed"
        return False, detail

    for _ in range(10):
        if _container_running(DOCKER_CONTAINER):
            return True, f"Container {DOCKER_CONTAINER} started."
        time.sleep(0.5)

    log_hint = ""
    cid = (stdout or "").strip().splitlines()[-1] if stdout else ""
    if cid:
        _, log_out, _ = _run_cmd(["docker", "logs", cid], timeout=10)
        if log_out:
            log_hint = f" Last logs: {log_out[-500:]}"

    return (
        False,
        f"Container {DOCKER_CONTAINER} exited right after start.{log_hint} "
        "Detached runs need a long-lived main process (use 'tail -f /dev/null' not 'exec bash'). "
        "Check: docker ps -a; journalctl -u robot-host-service",
    )


def _docker_stop():
    if not _container_running(DOCKER_CONTAINER):
        return True, f"Container {DOCKER_CONTAINER} is not running."

    ok, note = _stop_container(DOCKER_CONTAINER, DOCKER_STOP_TIMEOUT_SEC)
    if ok:
        return True, f"Container {DOCKER_CONTAINER} stopped."
    return False, note or f"Failed to stop {DOCKER_CONTAINER}."


def _schedule_host_poweroff():
    subprocess.Popen(
        ["bash", "-lc", HOST_POWEROFF_CMD],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


class HostServiceHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        if args and str(args[0]).startswith("GET "):
            return
        super().log_message(format, *args)

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, message, status=200):
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        pathname = parsed.path

        if pathname == "/status":
            running = _container_running(DOCKER_CONTAINER)
            self._send_json(
                {
                    "host_service": True,
                    "docker_running": running,
                    "container": DOCKER_CONTAINER,
                }
            )
            return

        if pathname == "/docker-start":
            ok, message = _docker_start()
            self._send_text(message, 200 if ok else 500)
            return

        if pathname == "/docker-stop":
            ok, message = _docker_stop()
            self._send_text(message, 200 if ok else 500)
            return

        if pathname == "/poweroff":
            summary = _poweroff_summary()
            _schedule_host_poweroff()
            self._send_json(summary, 200)
            self.wfile.flush()
            return

        self._send_text("Invalid request.", 404)


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", HOST_SERVICE_PORT), HostServiceHandler)
    print(
        f"Robot host service listening on port {HOST_SERVICE_PORT} "
        "(GET /status, /docker-start, /docker-stop, /poweroff)..."
    )
    server.serve_forever()
HOST_SERVICE_PY_EOF
  chmod 0755 "${HOST_SERVICE_PY}"
  substitute_jetson_home_in_py
}

install_systemd_unit() {
  cat > "/etc/systemd/system/${SERVICE_NAME}" << 'SYSTEMD_UNIT_EOF'
[Unit]
Description=Robot host service (Docker control and power off on port 8081)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/robot/host_service.py
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
SYSTEMD_UNIT_EOF
  chmod 0644 "/etc/systemd/system/${SERVICE_NAME}"
}

install_host_service_py
install_systemd_unit

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo ""
echo "Installed ${SERVICE_NAME}."
echo "  Status:  systemctl status ${SERVICE_NAME}"
echo "  Logs:    journalctl -u ${SERVICE_NAME} -f"
echo "  Paths:   Jetson home baked in as ${JETSON_HOME} (edit /opt/robot/host_service.py to change)"
echo "  Test:    curl -s http://127.0.0.1:8081/status"
echo ""
systemctl status "${SERVICE_NAME}" --no-pager || true
