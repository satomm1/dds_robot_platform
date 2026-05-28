#!/usr/bin/env python3
"""HTTP launcher on port 8080. Deploy on each robot; GUI polls GET /status every ~15s."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import subprocess
from urllib.parse import parse_qs, urlparse

launch_process = None

POWEROFF_TOKEN = os.environ.get("ROBOT_POWEROFF_TOKEN", "")

# --- Software update (git pull) template -----------------------------------
# Edit GIT_REPO_PATHS for your robot: each entry is an absolute path to a git
# checkout on the robot (typically under /workspace/catkin_ws/src/...).
# Optional: set ROBOT_UPDATE_REPOS_FILE to a JSON file listing paths, e.g.
#   ["/workspace/catkin_ws/src/mattbot_bringup", "/workspace/catkin_ws/src/other_pkg"]
GIT_REPO_PATHS = [
    "/workspace/catkin_ws/src/mattbot_bringup",
    "/workspace/catkin_ws/src/mattbot_dds",
    "/workspace/catkin_ws/src/mattbot_record",
    "/workspace/catkin_ws/src/mattbot_image_detection",
    "/workspace/catkin_ws/src/mattbot_mcl",
    "/workspace/catkin_ws/src/mattbot_navigation",
    "/workspace/catkin_ws/src/mattbot_teleop",
    "/workspace/catkin_ws/src/mattbot_database",
    "/workspace/catkin_ws/src/twist_mux",
    "/workspace/catkin_ws/src/path_planning"
]
UPDATE_REPOS_FILE = os.environ.get("ROBOT_UPDATE_REPOS_FILE", "")
GIT_PULL_TIMEOUT_SEC = int(os.environ.get("ROBOT_GIT_PULL_TIMEOUT_SEC", "120"))
CATKIN_WS_DIR = "/workspace/catkin_ws"
CATKIN_MAKE_TIMEOUT_SEC = int(os.environ.get("ROBOT_CATKIN_MAKE_TIMEOUT_SEC", "600"))

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


def _poweroff_token_ok(query_string):
    if not POWEROFF_TOKEN:
        return True
    values = parse_qs(query_string).get("token", [""])
    return (values[0] if values else "").strip() == POWEROFF_TOKEN


def _load_git_repo_paths():
    if UPDATE_REPOS_FILE:
        try:
            with open(UPDATE_REPOS_FILE, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, list):
                return [str(p).strip() for p in data if str(p).strip()]
        except (OSError, json.JSONDecodeError, TypeError):
            pass
    return list(GIT_REPO_PATHS)


def _git_pull_repo(repo_path):
    """Run git pull --ff-only in repo_path. Returns a result dict for JSON."""
    git_dir = os.path.join(repo_path, ".git")
    if not os.path.isdir(git_dir):
        return {
            "path": repo_path,
            "ok": False,
            "stdout": "",
            "stderr": f"Not a git repository: {repo_path}",
        }
    try:
        proc = subprocess.run(
            ["git", "-C", repo_path, "pull", "--ff-only"],
            capture_output=True,
            text=True,
            timeout=GIT_PULL_TIMEOUT_SEC,
        )
        return {
            "path": repo_path,
            "ok": proc.returncode == 0,
            "stdout": (proc.stdout or "").strip(),
            "stderr": (proc.stderr or "").strip(),
        }
    except subprocess.TimeoutExpired:
        return {
            "path": repo_path,
            "ok": False,
            "stdout": "",
            "stderr": f"git pull timed out after {GIT_PULL_TIMEOUT_SEC}s",
        }
    except OSError as exc:
        return {
            "path": repo_path,
            "ok": False,
            "stdout": "",
            "stderr": str(exc),
        }


def _run_catkin_make(workspace_dir):
    """Run catkin_make in workspace_dir after sourcing ROS. Returns a result dict."""
    if not os.path.isdir(workspace_dir):
        return {
            "path": workspace_dir,
            "ok": False,
            "stdout": "",
            "stderr": f"Catkin workspace not found: {workspace_dir}",
        }
    cmd = (
        "source /opt/ros/noetic/setup.bash && "
        f"cd {workspace_dir} && catkin_make"
    )
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            executable="/bin/bash",
            capture_output=True,
            text=True,
            timeout=CATKIN_MAKE_TIMEOUT_SEC,
        )
        return {
            "path": workspace_dir,
            "ok": proc.returncode == 0,
            "stdout": (proc.stdout or "").strip(),
            "stderr": (proc.stderr or "").strip(),
        }
    except subprocess.TimeoutExpired:
        return {
            "path": workspace_dir,
            "ok": False,
            "stdout": "",
            "stderr": f"catkin_make timed out after {CATKIN_MAKE_TIMEOUT_SEC}s",
        }
    except OSError as exc:
        return {
            "path": workspace_dir,
            "ok": False,
            "stdout": "",
            "stderr": str(exc),
        }


def _run_software_update(stop_ros=False, run_catkin_make=False):
    """
    Template entry point for /software-update.
    Pulls git repos, then optionally runs catkin_make in CATKIN_WS_DIR.
    """
    if stop_ros:
        _stop_ros_launch()

    repos = _load_git_repo_paths()
    if not repos:
        return {
            "ok": False,
            "message": "No git repo paths configured (edit GIT_REPO_PATHS or ROBOT_UPDATE_REPOS_FILE).",
            "repos": [],
            "catkin_make": None,
        }

    results = [_git_pull_repo(path) for path in repos]
    pulls_ok = all(entry["ok"] for entry in results)

    catkin_result = None
    if run_catkin_make:
        if pulls_ok:
            catkin_result = _run_catkin_make(CATKIN_WS_DIR)
        else:
            catkin_result = {
                "path": CATKIN_WS_DIR,
                "ok": False,
                "stdout": "",
                "stderr": "Skipped catkin_make because one or more git pulls failed.",
            }

    all_ok = pulls_ok and (catkin_result is None or catkin_result["ok"])
    if catkin_result and not catkin_result["ok"]:
        message = "Git pulls succeeded but catkin_make failed."
    elif not pulls_ok:
        message = "One or more git pulls failed."
    else:
        message = "Software update finished."

    return {
        "ok": all_ok,
        "message": message,
        "repos": results,
        "catkin_make": catkin_result,
    }


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
            if not _poweroff_token_ok(parsed.query):
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

        elif pathname == "/software-update":
            stop_ros = _parse_bool_query(parsed.query, "stop")
            run_build = _parse_bool_query(parsed.query, "build")
            payload = _run_software_update(stop_ros=stop_ros, run_catkin_make=run_build)
            body = json.dumps(payload, indent=2).encode("utf-8")
            status = 200 if payload.get("ok") else 500
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
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
        "(GET /status, /start, /stop, /host-poweroff, /software-update)..."
    )
    server.serve_forever()
