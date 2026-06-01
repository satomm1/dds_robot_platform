#!/usr/bin/env python3
"""HTTP host service on port 8081. Runs on the Jetson base machine (not inside Docker).

Endpoints: GET /status, /docker-start, /docker-stop, /poweroff
Deploy on Jetson: scp robot/jetson-host-install.sh and sudo bash ~/jetson-host-install.sh
Keep in sync with the embedded copy in jetson-host-install.sh.
"""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import subprocess
import time
from urllib.parse import urlparse

HOST_SERVICE_PORT = 8081
DOCKER_CONTAINER = "ros_noetic"
DOCKER_STOP_TIMEOUT_SEC = 30

# __JETSON_HOME__ is replaced with the install user's home when you run jetson-host-install.sh.
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

    # Container may take a moment to stay up; bash without -it exits instantly if misconfigured.
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
