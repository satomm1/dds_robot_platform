from ariadne import load_schema_from_path, make_executable_schema, gql, QueryType
import json
import logging
import os
import time
import numpy as np

from global_transform import get_global_transform_doc, require_global_transform
from ignite import ignite_client
from robot_images import has_image, image_url, read_meta
from se2 import transform_pose

logger = logging.getLogger(__name__)

md_cache = ignite_client.get_or_create_cache('map_metadata')
map_cache = ignite_client.get_or_create_cache('map')
query = QueryType()

STOP_REQUEST_CACHE = "robot_stop_request"
SHUTDOWN_REQUEST_CACHE = "robot_shutdown_request"
MULTI_ROBOT_GOAL_PLAN_CACHE = "multi_robot_goal_plan"
MULTI_ROBOT_GOAL_PLAN_ACTIVE_KEY = "active"
AIR_QUALITY_CACHE = "robot_air_quality"
# Drop detections older than this (Unix seconds); entries without timestamp are kept.
OBJECT_STALE_SEC = float(os.environ.get("OBJECT_STALE_SEC", "15"))
PERSON_OBJECT_STALE_SEC = float(os.environ.get("PERSON_OBJECT_STALE_SEC", "1.5"))


def _central_pose_to_global(x, y, theta):
    """Convert central-frame pose to global frame. Raises if transform missing."""
    if x is None or y is None or theta is None:
        return None, None, None
    doc = require_global_transform()
    return transform_pose(
        doc["R"],
        doc["t"],
        float(x),
        float(y),
        float(theta),
        forward=False,
        s=float(doc.get("s", 1.0)),
    )


def _air_quality_from_cache_row(robot_id, raw):
    if raw is None:
        return None
    doc = json.loads(raw)
    return {
        "robot_id": robot_id,
        "temperature": doc["temperature"],
        "relative_humidity": doc["relative_humidity"],
        "voc_index": doc["voc_index"],
        "nox_index": doc["nox_index"],
        "timestamp": doc["timestamp"],
    }


@query.field("map")
def resolve_data(*_):
    md = md_cache.get(1)
    map = map_cache.get(1)
    if md is None or map is None:
        logger.debug("map query: missing map_metadata or map bytes")
        return {
            "occupancy": [],
            "height": 0,
            "width": 0,
            "resolution": 1.0,
            "origin_x": 0.0,
            "origin_y": 0.0,
            "origin_z": 0.0,
            "origin_orientation_x": 0.0,
            "origin_orientation_y": 0.0,
            "origin_orientation_z": 0.0,
            "origin_orientation_w": 1.0,
        }
    map = np.frombuffer(map, dtype=int)
    md = json.loads(md)
    map = map.tolist()
    return {
        "occupancy": map,
        "height": md["height"],
        "width": md["width"],
        "resolution": md["resolution"],
        "origin_x": md["origin.position.x"],
        "origin_y": md["origin.position.y"],
        "origin_z": md["origin.position.z"],
        "origin_orientation_x": md["origin.orientation.x"],
        "origin_orientation_y": md["origin.orientation.y"],
        "origin_orientation_z": md["origin.orientation.z"],
        "origin_orientation_w": md["origin.orientation.w"]
    }

def _robot_position_from_cache(robot_id, raw):
    if raw is None:
        return {
            "x": None,
            "y": None,
            "theta": None,
            "position_timestamp": None,
        }
    robot = json.loads(raw)
    ts = robot.get("position_timestamp")
    return {
        "x": robot["x"],
        "y": robot["y"],
        "theta": robot["theta"],
        "position_timestamp": float(ts) if ts is not None else None,
    }


@query.field("robotPosition")
def resolve_data(*_, robot_id: int):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    robot = position_cache.get(robot_id)
    return _robot_position_from_cache(robot_id, robot)


@query.field("robotPositions")
def resolve_data(*_):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    robots = position_cache.scan()
    all_robots = []
    for robot in robots:
        robot_id = robot[0]
        pos = _robot_position_from_cache(robot_id, robot[1])
        all_robots.append({
            "id": robot_id,
            "x": pos["x"],
            "y": pos["y"],
            "theta": pos["theta"],
            "position_timestamp": pos["position_timestamp"],
        })
    return all_robots

@query.field("robotInitialPosition")
def resolve_data(*_, robot_id: int):
    position_cache = ignite_client.get_or_create_cache('robot_initial_position')
    robot = position_cache.get(robot_id)
    if robot is None:
        return {
            "x_init": None,
            "y_init": None,
            "theta_init": None
        }
    robot = json.loads(robot)
    return {
        "x_init": robot["x"],
        "y_init": robot["y"],
        "theta_init": robot["theta"],
        "init_timestamp": robot.get("timestamp", None)
    }

@query.field("robotInitialPositions")
def resolve_data(*_):
    position_cache = ignite_client.get_or_create_cache('robot_initial_position')
    robots = position_cache.scan()
    all_robots = []
    for robot in robots:
        robot_id = robot[0]
        robot = json.loads(robot[1])
        all_robots.append({
            "id": robot_id,
            "x_init": robot["x"],
            "y_init": robot["y"],
            "theta_init": robot["theta"],
            "init_timestamp": robot.get("timestamp", None)
        })
    return all_robots

@query.field("robotVelocity")
def resolve_data(*_, robot_id: int):
    velocity_cache = ignite_client.get_or_create_cache('robot_odom')
    robot = velocity_cache.get(robot_id)
    if robot is None:
        return {
            "v_x": None,
            "v_y": None,
            "v_theta": None
        }
    robot = json.loads(robot)
    return {
        "v_x": robot["vel_x"],
        "v_y": robot["vel_y"],
        "v_theta": robot["vel_theta"]
    }

@query.field("robotGoal")
def resolve_data(*_, robot_id: int):
    goal_cache = ignite_client.get_or_create_cache('robot_goal')
    robot = goal_cache.get(robot_id)
    if robot is None:
        return {
            "x_goal": None,
            "y_goal": None,
            "theta_goal": None,
            "goal_timestamp": None,
            "goal_valid": True
        }
    robot = json.loads(robot)
    from_bot = 0
    if "from_bot" in robot and robot["from_bot"]:
        from_bot = 1
    return {
        "x_goal": robot["x"],
        "y_goal": robot["y"],
        "theta_goal": robot["theta"],
        "goal_timestamp": robot["timestamp"],
        "goal_from_bot": from_bot,
        "goal_valid": robot.get("valid", True)
    }

@query.field("robotGoals")
def resolve_data(*_):
    goal_cache = ignite_client.get_or_create_cache('robot_goal')
    goals = goal_cache.scan()
    all_goals = []
    for goal in goals:
        robot_id = goal[0]
        goal = json.loads(goal[1])
        all_goals.append({
            "id": robot_id,
            "x_goal": goal["x"],
            "y_goal": goal["y"],
            "theta_goal": goal["theta"],
            "goal_timestamp": goal["timestamp"],
            "goal_valid": goal.get("valid", True)
        })
    return all_goals


@query.field("globalRobotPosition")
def resolve_global_robot_position(*_, robot_id: int):
    # Ensure transform exists before reading (clear error if misconfigured)
    require_global_transform()
    position_cache = ignite_client.get_or_create_cache('robot_position')
    robot = position_cache.get(robot_id)
    pos = _robot_position_from_cache(robot_id, robot)
    gx, gy, gtheta = _central_pose_to_global(pos["x"], pos["y"], pos["theta"])
    return {
        "x": gx,
        "y": gy,
        "theta": gtheta,
        "position_timestamp": pos["position_timestamp"],
    }


@query.field("globalRobotPositions")
def resolve_global_robot_positions(*_):
    require_global_transform()
    position_cache = ignite_client.get_or_create_cache('robot_position')
    robots = position_cache.scan()
    all_robots = []
    for robot in robots:
        robot_id = robot[0]
        pos = _robot_position_from_cache(robot_id, robot[1])
        gx, gy, gtheta = _central_pose_to_global(pos["x"], pos["y"], pos["theta"])
        all_robots.append({
            "id": robot_id,
            "x": gx,
            "y": gy,
            "theta": gtheta,
            "position_timestamp": pos["position_timestamp"],
        })
    return all_robots


def _robot_goal_from_cache(raw):
    if raw is None:
        return {
            "x_goal": None,
            "y_goal": None,
            "theta_goal": None,
            "goal_timestamp": None,
            "goal_from_bot": 0,
            "goal_valid": True,
        }
    robot = json.loads(raw)
    from_bot = 0
    if "from_bot" in robot and robot["from_bot"]:
        from_bot = 1
    return {
        "x_goal": robot["x"],
        "y_goal": robot["y"],
        "theta_goal": robot["theta"],
        "goal_timestamp": robot["timestamp"],
        "goal_from_bot": from_bot,
        "goal_valid": robot.get("valid", True),
    }


@query.field("globalRobotGoal")
def resolve_global_robot_goal(*_, robot_id: int):
    require_global_transform()
    goal_cache = ignite_client.get_or_create_cache('robot_goal')
    goal = _robot_goal_from_cache(goal_cache.get(robot_id))
    gx, gy, gtheta = _central_pose_to_global(
        goal["x_goal"], goal["y_goal"], goal["theta_goal"]
    )
    return {
        "x_goal": gx,
        "y_goal": gy,
        "theta_goal": gtheta,
        "goal_timestamp": goal["goal_timestamp"],
        "goal_from_bot": goal["goal_from_bot"],
        "goal_valid": goal["goal_valid"],
    }


@query.field("globalRobotGoals")
def resolve_global_robot_goals(*_):
    require_global_transform()
    goal_cache = ignite_client.get_or_create_cache('robot_goal')
    goals = goal_cache.scan()
    all_goals = []
    for entry in goals:
        robot_id = entry[0]
        goal = _robot_goal_from_cache(entry[1])
        gx, gy, gtheta = _central_pose_to_global(
            goal["x_goal"], goal["y_goal"], goal["theta_goal"]
        )
        all_goals.append({
            "id": robot_id,
            "x_goal": gx,
            "y_goal": gy,
            "theta_goal": gtheta,
            "goal_timestamp": goal["goal_timestamp"],
            "goal_valid": goal["goal_valid"],
        })
    return all_goals


@query.field("globalTransform")
def resolve_global_transform(*_):
    doc = get_global_transform_doc()
    if doc is None:
        return {
            "R": [0],
            "t": [0],
            "s": 1.0,
            "timestamp": 0,
        }
    return {
        "R": doc["R"],
        "t": doc["t"],
        "s": float(doc.get("s", 1.0)),
        "timestamp": doc.get("timestamp", 0),
    }


@query.field("activeMultiRobotGoalPlan")
def resolve_active_multi_robot_goal_plan(*_):
    plan_cache = ignite_client.get_or_create_cache(MULTI_ROBOT_GOAL_PLAN_CACHE)
    raw = plan_cache.get(MULTI_ROBOT_GOAL_PLAN_ACTIVE_KEY)
    if raw is None:
        return None
    try:
        doc = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        logger.warning("activeMultiRobotGoalPlan invalid JSON: %s", exc)
        return None
    goals_out = []

    for e in doc.get("goals") or []:
        goals_out.append(
            {
                "robot_id": int(e["robot_id"]),
                "x_goal": float(e["x"]),
                "y_goal": float(e["y"]),
                "theta_goal": float(e["theta"]),
            }
        )
    return {
        "plan_id": str(doc.get("plan_id", "")),
        "coordinated": bool(doc.get("coordinated", True)),
        "plan_timestamp": float(doc.get("plan_timestamp", 0.0)),
        "goals": goals_out,
    }


@query.field("pendingRobotStops")
def resolve_pending_robot_stops(*_):
    stop_cache = ignite_client.get_or_create_cache(STOP_REQUEST_CACHE)
    pending = []
    try:
        for row in stop_cache.scan():
            robot_id, raw = row[0], row[1]
            if raw is None:
                continue
            doc = json.loads(raw)
            if doc.get("pending"):
                pending.append(
                    {
                        "id": int(robot_id),
                        "requested_at": float(doc.get("requested_at", 0.0)),
                    }
                )
    except Exception as exc:
        logger.exception("pendingRobotStops scan failed: %s", exc)
    return pending


@query.field("pendingRobotShutdowns")
def resolve_pending_robot_shutdowns(*_):
    shutdown_cache = ignite_client.get_or_create_cache(SHUTDOWN_REQUEST_CACHE)
    pending = []
    try:
        for row in shutdown_cache.scan():
            robot_id, raw = row[0], row[1]
            if raw is None:
                continue
            doc = json.loads(raw)
            if doc.get("pending"):
                pending.append(
                    {
                        "id": int(robot_id),
                        "requested_at": float(doc.get("requested_at", 0.0)),
                    }
                )
    except Exception as exc:
        logger.exception("pendingRobotShutdowns scan failed: %s", exc)
    return pending


@query.field("robotPath")
def resolve_data(*_, robot_id: int):
    path_cache = ignite_client.get_or_create_cache('cmd_smoothed_path')
    robot = path_cache.get(robot_id)
    if robot is None:
        return {
            "id": robot_id,
            "x": None,
            "y": None,
            "t": None
        }
    robot = json.loads(robot)
    return {
        "id": robot_id,
        "x": robot["x"],
        "y": robot["y"],
        "t": robot["t"]
    }

@query.field("robotPaths")
def resolve_data(*_):
    path_cache = ignite_client.get_or_create_cache('cmd_smoothed_path')
    paths = path_cache.scan()
    all_paths = []
    for path in paths:
        robot_id = path[0]
        path = json.loads(path[1])
        all_paths.append({
            "id": robot_id,
            "x": path["x"],
            "y": path["y"],
            "t": path["t"]
        })
    return all_paths

@query.field("robotScan")
def resolve_data(*_, robot_id: int):
    scan_cache = ignite_client.get_or_create_cache('robot_scan')
    robot = scan_cache.get(robot_id)
    if robot is None:
        logger.debug("robotScan cache miss for robot_id=%s", robot_id)
        return {
            "id": robot_id,
            "ranges": [],
            "range_min": 0.0,
            "range_max": 0.0,
            "angle_min": 0.0,
            "angle_max": 0.0,
            "angle_increment": 0.0,
            "timestamp": 0.0,
        }
    try:
        robot = json.loads(robot)
    except (TypeError, json.JSONDecodeError) as exc:
        logger.warning("robotScan invalid JSON for robot_id=%s: %s", robot_id, exc)
        return {
            "id": robot_id,
            "ranges": [],
            "range_min": 0.0,
            "range_max": 0.0,
            "angle_min": 0.0,
            "angle_max": 0.0,
            "angle_increment": 0.0,
            "timestamp": 0.0,
        }
    return {
        "id": int(robot.get("robot_id", robot_id)),
        "ranges": robot.get("ranges", []),
        "range_min": robot.get("range_min", 0.0),
        "range_max": robot.get("range_max", 0.0),
        "angle_min": robot.get("angle_min", 0.0),
        "angle_max": robot.get("angle_max", 0.0),
        "angle_increment": robot.get("angle_increment", 0.0),
        "timestamp": robot.get("timestamp", 0.0),
    }

# @query.field("robotImage")
# def resolve_data(*_, robot_id: int):
#     image_cache = ignite_client.get_or_create_cache('robot_image')
#     robot = image_cache.get(robot_id)
#     return {
#         "id": robot_id,
#         "image": robot
#     }

@query.field("robotStatus")
def resolve_data(*_, robot_id: int):
    status_cache = ignite_client.get_or_create_cache('robot_status')
    robot = status_cache.get(robot_id)
    if robot is None:
        return {
            "id": robot_id,
            "status": None
        }
    if robot == 0:
        status = "stopped"
    elif robot == 1:
        status = "moving"
    else: 
        status = "unknown"    
    return {
        "id": robot_id,
        "status": status
    }

@query.field("stoppedRobotPositions")
def resolve_data(*_):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    status_cache = ignite_client.get_or_create_cache('robot_status')
    robots = position_cache.scan()
    all_robots = []
    for robot in robots:
        robot_id = robot[0]
        robot = json.loads(robot[1])
        status = status_cache.get(robot_id)
        if status == 0:
            all_robots.append({
                "id": robot_id,
                "x": robot["x"],
                "y": robot["y"],
                "theta": robot["theta"]
            })
    return all_robots

def _object_positions_from_cache():
    position_cache = ignite_client.get_or_create_cache('detected_objects')
    objects = position_cache.scan()
    all_objects = []
    now = time.time()

    id = 0
    for row in objects:
        robot_id = int(row[0])
        try:
            by_num = json.loads(row[1])
        except (TypeError, json.JSONDecodeError) as exc:
            logger.warning("objectPositions bad JSON for agent_id=%s: %s", robot_id, exc)
            continue

        kept = {}
        for key, object in by_num.items():
            ts = object.get("timestamp")
            if ts is not None:
                try:
                    stale_limit = (
                        PERSON_OBJECT_STALE_SEC
                        if object.get("class_name") == "person"
                        else OBJECT_STALE_SEC
                    )
                    if now - float(ts) > stale_limit:
                        continue
                except (TypeError, ValueError):
                    pass
            kept[key] = object
            all_objects.append({
                "id": id,
                "robot_id": robot_id,
                "x": object["x"],
                "y": object["y"],
                "type": object["class_name"],
                "timestamp": object.get("timestamp"),
            })
            id += 1

        # Persist prune so Ignite does not keep stale detections forever
        if len(kept) != len(by_num):
            try:
                if kept:
                    position_cache.put(robot_id, json.dumps(kept))
                else:
                    position_cache.remove(robot_id)
            except Exception as exc:
                logger.warning("objectPositions prune failed agent_id=%s: %s", robot_id, exc)

    return all_objects


@query.field("objectPositions")
def resolve_data(*_):
    return _object_positions_from_cache()


@query.field("globalObjectPositions")
def resolve_global_object_positions(*_):
    require_global_transform()
    all_objects = []
    for obj in _object_positions_from_cache():
        gx, gy, _gtheta = _central_pose_to_global(obj["x"], obj["y"], 0.0)
        all_objects.append({
            "id": obj["id"],
            "robot_id": obj.get("robot_id"),
            "x": gx,
            "y": gy,
            "type": obj["type"],
            "timestamp": obj.get("timestamp"),
        })
    return all_objects


@query.field("transform")
def resolve_data(*_):
    transform_cache = ignite_client.get_or_create_cache('transform')
    transform = transform_cache.get(1)
    if transform is None:
        return {
            "R": [0],
            "t": [0],
            "s": 1.0,
            "timestamp": 0
        }
    
    transform = json.loads(transform)
    return {
        "R": transform["R"],
        "t": transform["t"],
        "s": 1.0,
        "timestamp": transform["timestamp"]
    }

@query.field("subscribed_agents")
def resolve_data(*_):
    agent_cache = ignite_client.get_or_create_cache('subscribed_agents')
    agents = agent_cache.get(1)
    if agents is None:
        return {"id": []}
    agents = json.loads(agents)
    
    if len(agents)==0 or agents[0] == -1:
        return {"id": []}
    
    return {"id": agents}

@query.field("exitedAgents")
def resolve_data(*_):
    agent_cache = ignite_client.get_or_create_cache('exited_agents')
    agents = agent_cache.get(1)
    if agents is None:
        return {"id": []}
    agents = json.loads(agents)
    
    if len(agents)==0 or agents[0] == -1:
        return {"id": []}
    
    return {"id": agents}

@query.field("subscribedAndExitedAgents")
def resolve_data(*_):
    agent_cache = ignite_client.get_or_create_cache('subscribed_agents')
    exited_agent_cache = ignite_client.get_or_create_cache('exited_agents')
    agents = agent_cache.get(1)
    exited_agents = exited_agent_cache.get(1)
    
    if agents is None:
        agents = []
    else:
        agents = json.loads(agents)
    
    if exited_agents is None:
        exited_agents = []
    else:
        exited_agents = json.loads(exited_agents)
    
    return [
        {"id": agents},   {"id": exited_agents}
        ]


@query.field("airQuality")
def resolve_air_quality(*_, robot_id: int):
    air_quality_cache = ignite_client.get_or_create_cache(AIR_QUALITY_CACHE)
    raw = air_quality_cache.get(robot_id)
    return _air_quality_from_cache_row(robot_id, raw)


@query.field("airQualities")
def resolve_air_qualities(*_):
    air_quality_cache = ignite_client.get_or_create_cache(AIR_QUALITY_CACHE)
    rows = air_quality_cache.scan()
    result = []
    for robot_id, raw in rows:
        entry = _air_quality_from_cache_row(robot_id, raw)
        if entry is not None:
            result.append(entry)
    return result


@query.field("robotImageMeta")
def resolve_robot_image_meta(*_, robot_id: int):
    if not has_image(robot_id):
        return None
    meta = read_meta(robot_id) or {}
    return {
        "robot_id": int(robot_id),
        "timestamp": meta.get("timestamp"),
        "width": meta.get("width"),
        "height": meta.get("height"),
        "url": image_url(robot_id),
    }
