#!/usr/bin/env python3
"""HTTP launcher on port 8080. Deploy on each robot; GUI polls GET /status every ~15s."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import subprocess
from urllib.parse import parse_qs, urlparse

launch_process = None


def _parse_bool_query(query_string, param_name):
    """True when query param is true, 1, or yes (case-insensitive). Missing → false."""
    if not query_string:
        return False
    values = parse_qs(query_string).get(param_name, ["false"])
    token = (values[0] if values else "false").strip().lower()
    return token in ("true", "1", "yes")


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
            multi_arg = "true" if multi else "false"

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
                launch_file = "tall.launch" if robot_height == "tall" else "short.launch"
                car_arg = "true" if robot_car == "true" else "false"
                cmd = (
                    "source /opt/ros/noetic/setup.bash && "
                    "source /workspace/catkin_ws/devel/setup.bash && "
                    "source /workspace/catkin_ws/src/robot_env.sh && "
                    f"roslaunch mattbot_bringup {launch_file} car:={car_arg} "
                    f"social:={social_arg} multi:={multi_arg}"
                )
                launch_process = subprocess.Popen(
                    cmd, shell=True, executable="/bin/bash"
                )
                planner = "social" if social else "A*"
                multi_note = ", multi-robot planning on" if multi else ""
                msg = (
                    f"ROS Launch started successfully "
                    f"({launch_file}, {planner} planner{multi_note})."
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
                launch_process.terminate()
                launch_process = None
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ROS Launch stopped cleanly.")
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Nothing is currently running.")
            return

        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Invalid request.")
            return


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 8080), LaunchServer)
    print("Web launcher listening on port 8080 (GET /status, /start, /stop)...")
    server.serve_forever()
