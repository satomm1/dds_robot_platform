#!/usr/bin/env python3
"""HTTP launcher on port 8080. Deploy on each robot; GUI polls GET /status every ~15s."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import subprocess
from urllib.parse import parse_qs, urlparse

launch_process = None

POWEROFF_TOKEN = os.environ.get("ROBOT_POWEROFF_TOKEN", "")

# Host shutdown only (no docker stop). Use nohup so the HTTP handler can return
# before the machine halts; Docker stops when the host shuts down.
HOST_POWEROFF_CMD = (
    "nohup bash -c '/usr/sbin/shutdown -h now' </dev/null >/dev/null 2>&1 &"
)

NSENTER_POWEROFF = [
    "nsenter",
    "-t",
    "1",
    "-m",
    "-u",
    "-i",
    "-n",
    "bash",
    "-lc",
    HOST_POWEROFF_CMD,
]

# Single-robot vs multi-robot bringup (same car/social args on each).
LAUNCH_FILES = {
    ("tall", False): "tall.launch",
    ("short", False): "short.launch",
    ("tall", True): "multi_agent_tall.launch",
    ("short", True): "multi_agent_short.launch",
}


def _parse_bool_query(query_string, param_name):
    """True when query param is true, 1, or yes (case-insensitive). Missing → false."""
    if not query_string:
        return False
    values = parse_qs(query_string).get(param_name, ["false"])
    token = (values[0] if values else "false").strip().lower()
    return token in ("true", "1", "yes")


def _token_ok(query_string):
    if not POWEROFF_TOKEN:
        return True
    values = parse_qs(query_string).get("token", [""])
    return (values[0] if values else "").strip() == POWEROFF_TOKEN


def _stop_ros_launch():
    global launch_process
    if launch_process and launch_process.poll() is None:
        launch_process.terminate()
        try:
            launch_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            launch_process.kill()
    launch_process = None


def _schedule_host_poweroff():
    subprocess.Popen(
        NSENTER_POWEROFF,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


class LaunchServer(BaseHTTPRequestHandler):
    def _ros_running(self):
        return launch_process is not None and launch_process.poll() is None

    def log_message(self, format, *args):
        """Suppress access-log lines for GET (e.g. /status polling from the GUI)."""
        if args and str(args[0]).startswith("GET "):
            return
        super().log_message(format, *args)

    def do_GET(self):
        global launch_process

        parsed = urlparse(self.path)
        pathname = parsed.path

        if pathname == "/status":
            ros_running = self._ros_running()
            payload = {
                "launcher": True,
                "ros_running": ros_running,
                "available": not ros_running,
            }
            body = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        elif pathname == "/start":
            social = _parse_bool_query(parsed.query, "social")
            multi = _parse_bool_query(parsed.query, "multi")
            social_arg = "true" if social else "false"

            if launch_process is None or launch_process.poll() is not None:
                env_cmd = (
                    "source /opt/ros/noetic/setup.bash && "
                    "source /workspace/catkin_ws/devel/setup.bash && "
                    "source /workspace/catkin_ws/src/robot_env.sh && "
                    "printf '%s\\n%s' \"$ROBOT_HEIGHT\" \"$ROBOT_CAR\""
                )
                env_out = subprocess.run(
                    env_cmd,
                    shell=True,
                    executable="/bin/bash",
                    capture_output=True,
                    text=True,
                ).stdout.strip()
                parts = env_out.split("\n", 1)
                robot_height = (parts[0] if parts else "").strip().lower()
                robot_car = (parts[1] if len(parts) > 1 else "false").strip().lower()
                is_tall = robot_height == "tall"
                car_arg = "true" if robot_car == "true" else "false"
                launch_file = LAUNCH_FILES[("tall" if is_tall else "short", multi)]
                cmd = (
                    "source /opt/ros/noetic/setup.bash && "
                    "source /workspace/catkin_ws/devel/setup.bash && "
                    "source /workspace/catkin_ws/src/robot_env.sh && "
                    f"roslaunch mattbot_bringup {launch_file} car:={car_arg} social:={social_arg}"
                )
                launch_process = subprocess.Popen(
                    cmd, shell=True, executable="/bin/bash"
                )
                planner = "social" if social else "A*"
                mode = "multi-robot" if multi else "single-robot"
                msg = (
                    f"ROS Launch started successfully "
                    f"({launch_file}, {mode}, {planner} planner)."
                )
                self.send_response(200)
                self.end_headers()
                self.wfile.write(msg.encode("utf-8"))
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Launch file is already running.")
            return

        elif pathname == "/stop":
            if launch_process and launch_process.poll() is None:
                _stop_ros_launch()
                msg = b"ROS Launch stopped cleanly."
            else:
                msg = b"Nothing is currently running."
            self.send_response(200)
            self.end_headers()
            self.wfile.write(msg)
            return

        elif pathname == "/host-poweroff":
            if not _token_ok(parsed.query):
                self.send_response(403)
                self.end_headers()
                self.wfile.write(b"Forbidden.")
                return

            _stop_ros_launch()

            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ROS stopped; host shutdown scheduled.")
            self.wfile.flush()

            _schedule_host_poweroff()
            return

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Invalid request.")
            return


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8080), LaunchServer)
    print(
        "Web launcher listening on port 8080 "
        "(GET /status, /start, /stop, /host-poweroff)..."
    )
    server.serve_forever()
