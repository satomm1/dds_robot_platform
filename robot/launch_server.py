#!/usr/bin/env python3
"""HTTP launcher on port 8080. Deploy on each robot; GUI polls GET /status every ~15s."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import subprocess

launch_process = None


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

        if self.path == "/status":
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

        elif self.path == "/start":
            if launch_process is None or launch_process.poll() is not None:
                cmd = (
                    "source /opt/ros/noetic/setup.bash && "
                    "source /workspace/catkin_ws/devel/setup.bash && "
                    "source /workspace/catkin_ws/src/robot_env.sh && "
                    "roslaunch mattbot_bringup short.launch"
                )
                launch_process = subprocess.Popen(
                    cmd, shell=True, executable="/bin/bash"
                )
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ROS Launch started successfully!")
            else:
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Launch file is already running.")
            return

        elif self.path == "/stop":
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
