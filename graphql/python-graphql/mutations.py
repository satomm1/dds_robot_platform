from ariadne import load_schema_from_path, make_executable_schema, gql, MutationType
import json
import logging
import time
import numpy as np
import base64

from global_transform import require_global_transform
from ignite import ignite_client
from se2 import transform_pose

mutation = MutationType()
logger = logging.getLogger(__name__)

STOP_REQUEST_CACHE = "robot_stop_request"
SHUTDOWN_REQUEST_CACHE = "robot_shutdown_request"
MULTI_ROBOT_GOAL_PLAN_CACHE = "multi_robot_goal_plan"
MULTI_ROBOT_GOAL_PLAN_ACTIVE_KEY = "active"
AIR_QUALITY_CACHE = "robot_air_quality"


@mutation.field("requestRobotStop")
def resolve_request_robot_stop(_, info, robot_id: int):
    stop_cache = ignite_client.get_or_create_cache(STOP_REQUEST_CACHE)
    path_cache = ignite_client.get_or_create_cache("cmd_smoothed_path")
    payload = {
        "requested_at": time.time(),
        "pending": True,
    }
    try:
        stop_cache.put(robot_id, json.dumps(payload))
        try:
            path_cache.remove_key(robot_id)
        except Exception:
            logger.debug(
                "requestRobotStop: no path entry or remove_key failed for robot_id=%s",
                robot_id,
            )
        return True
    except Exception as exc:
        logger.exception("requestRobotStop failed for robot_id=%s: %s", robot_id, exc)
        return False


@mutation.field("requestRobotShutdown")
def resolve_request_robot_shutdown(_, info, robot_id: int):
    shutdown_cache = ignite_client.get_or_create_cache(SHUTDOWN_REQUEST_CACHE)
    path_cache = ignite_client.get_or_create_cache("cmd_smoothed_path")
    payload = {
        "requested_at": time.time(),
        "pending": True,
    }
    try:
        shutdown_cache.put(robot_id, json.dumps(payload))
        try:
            path_cache.remove_key(robot_id)
        except Exception:
            logger.debug(
                "requestRobotShutdown: no path entry or remove_key failed for robot_id=%s",
                robot_id,
            )
        return True
    except Exception as exc:
        logger.exception("requestRobotShutdown failed for robot_id=%s: %s", robot_id, exc)
        return False


@mutation.field("clearRobotPath")
def resolve_clear_robot_path(_, info, robot_id: int):
    path_cache = ignite_client.get_or_create_cache("cmd_smoothed_path")
    try:
        path_cache.remove_key(robot_id)
        return True
    except Exception as exc:
        logger.exception("clearRobotPath failed for robot_id=%s: %s", robot_id, exc)
        return False


@mutation.field("consumeRobotStopRequest")
def resolve_consume_robot_stop_request(_, info, robot_id: int):
    stop_cache = ignite_client.get_or_create_cache(STOP_REQUEST_CACHE)
    try:
        stop_cache.remove_key(robot_id)
        return True
    except Exception as exc:
        logger.debug(
            "consumeRobotStopRequest remove_key for robot_id=%s: %s",
            robot_id,
            exc,
        )
        return False


@mutation.field("consumeRobotShutdownRequest")
def resolve_consume_robot_shutdown_request(_, info, robot_id: int):
    shutdown_cache = ignite_client.get_or_create_cache(SHUTDOWN_REQUEST_CACHE)
    try:
        shutdown_cache.remove_key(robot_id)
        return True
    except Exception as exc:
        logger.debug(
            "consumeRobotShutdownRequest remove_key for robot_id=%s: %s",
            robot_id,
            exc,
        )
        return False


@mutation.field("setMultiRobotGoalPlan")
def resolve_set_multi_robot_goal_plan(_, info, plan_id, coordinated, plan_timestamp, goals):
    if not goals or len(goals) < 2:
        logger.warning("setMultiRobotGoalPlan: need at least two goals, got %s", len(goals or []))
        return False
    goal_cache = ignite_client.get_or_create_cache("robot_goal")
    plan_cache = ignite_client.get_or_create_cache(MULTI_ROBOT_GOAL_PLAN_CACHE)
    stored_goals = []
    robot_ids = []
    for g in goals:
        rid = int(g["robot_id"])
        robot_ids.append(rid)
        stored_goals.append(
            {
                "robot_id": rid,
                "x": float(g["x_goal"]),
                "y": float(g["y_goal"]),
                "theta": float(g["theta_goal"]),
            }
        )
    doc = {
        "plan_id": str(plan_id),
        "coordinated": bool(coordinated),
        "plan_timestamp": float(plan_timestamp),
        "goals": stored_goals,
    }
    try:
        for rid in robot_ids:
            try:
                goal_cache.remove_key(rid)
            except Exception:
                pass
        plan_cache.put(MULTI_ROBOT_GOAL_PLAN_ACTIVE_KEY, json.dumps(doc))
        return True
    except Exception as exc:
        logger.exception("setMultiRobotGoalPlan failed: %s", exc)
        return False


@mutation.field("consumeMultiRobotGoalPlan")
def resolve_consume_multi_robot_goal_plan(_, info):
    plan_cache = ignite_client.get_or_create_cache(MULTI_ROBOT_GOAL_PLAN_CACHE)
    try:
        plan_cache.remove_key(MULTI_ROBOT_GOAL_PLAN_ACTIVE_KEY)
        return True
    except Exception as exc:
        logger.debug("consumeMultiRobotGoalPlan: %s", exc)
        return False


@mutation.field("setRobotGoal")
def resolve_set_robot_goal(_, info, robot_id, x_goal, y_goal, theta_goal, goal_timestamp, from_bot=None, goal_valid=True):
    goal_cache = ignite_client.get_or_create_cache('robot_goal')
    goal = {
        "x": x_goal,
        "y": y_goal,
        "theta": theta_goal,
        "timestamp": goal_timestamp,
        "valid": goal_valid
    }
    if from_bot is not None:
        goal["from_bot"] = from_bot
    try:
        goal_cache.put(robot_id, json.dumps(goal))
        return True
    except Exception as exc:
        logger.exception("setRobotGoal failed for robot_id=%s: %s", robot_id, exc)
        return False


@mutation.field("setGlobalRobotGoal")
def resolve_set_global_robot_goal(
    _,
    info,
    robot_id,
    x_goal,
    y_goal,
    theta_goal,
    goal_timestamp,
    goal_valid=True,
):
    """Accept a goal in the global map frame; store it in central Ignite coordinates."""
    try:
        doc = require_global_transform()
        cx, cy, ctheta = transform_pose(
            doc["R"],
            doc["t"],
            float(x_goal),
            float(y_goal),
            float(theta_goal),
            forward=True,
            s=float(doc.get("s", 1.0)),
        )
    except Exception as exc:
        logger.exception("setGlobalRobotGoal transform failed for robot_id=%s: %s", robot_id, exc)
        raise

    return resolve_set_robot_goal(
        _,
        info,
        robot_id,
        cx,
        cy,
        ctheta,
        goal_timestamp,
        from_bot=False,
        goal_valid=goal_valid,
    )

@mutation.field("setRobotPosition")
def resolve_set_robot_position(_, info, robot_id, x, y, theta, position_timestamp=None):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    position = {
        "x": x,
        "y": y,
        "theta": theta,
    }
    if position_timestamp is not None:
        position["position_timestamp"] = float(position_timestamp)
    try:
        position_cache.put(robot_id, json.dumps(position))
        return True
    except Exception as exc:
        logger.exception("setRobotPosition failed for robot_id=%s: %s", robot_id, exc)
        return False    
@mutation.field("setRobotInitialPosition")
def resolve_set_robot_initial_position(_, info, robot_id, x_init, y_init, theta_init, init_timestamp):
    position_cache = ignite_client.get_or_create_cache('robot_initial_position')
    position = {
        "x": x_init,
        "y": y_init,
        "theta": theta_init,
        "timestamp": init_timestamp
    }
    try:
        position_cache.put(robot_id, json.dumps(position))
        return True
    except Exception as exc:
        logger.exception("setRobotInitialPosition failed for robot_id=%s: %s", robot_id, exc)
        return False
    
@mutation.field("clearRobotPosition")
def resolve_clear_robot_position(_, info, robot_id):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    try:
        position_cache.remove_key(robot_id)
        return True
    except Exception as exc:
        logger.exception("clearRobotPosition failed for robot_id=%s: %s", robot_id, exc)
        return False
    
@mutation.field("clearRobot")
def resolve_clear_robot(_, info, robot_id):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    path_cache = ignite_client.get_or_create_cache('cmd_smoothed_path')
    goal_cache = ignite_client.get_or_create_cache('robot_goal')
    stop_cache = ignite_client.get_or_create_cache(STOP_REQUEST_CACHE)
    shutdown_cache = ignite_client.get_or_create_cache(SHUTDOWN_REQUEST_CACHE)
    try:
        position_cache.remove_key(robot_id)
        path_cache.remove_key(robot_id)
        goal_cache.remove_key(robot_id)
        try:
            stop_cache.remove_key(robot_id)
        except Exception:
            pass
        try:
            shutdown_cache.remove_key(robot_id)
        except Exception:
            pass
        air_quality_cache = ignite_client.get_or_create_cache(AIR_QUALITY_CACHE)
        try:
            air_quality_cache.remove_key(robot_id)
        except Exception:
            pass
        return True
    except Exception as exc:
        logger.exception("clearRobot failed for robot_id=%s: %s", robot_id, exc)
        return False


@mutation.field("setAirQuality")
def resolve_set_air_quality(
    _,
    info,
    robot_id,
    temperature,
    relative_humidity,
    voc_index,
    nox_index,
    timestamp,
):
    air_quality_cache = ignite_client.get_or_create_cache(AIR_QUALITY_CACHE)
    payload = {
        "temperature": float(temperature),
        "relative_humidity": float(relative_humidity),
        "voc_index": float(voc_index),
        "nox_index": float(nox_index),
        "timestamp": float(timestamp),
    }
    try:
        air_quality_cache.put(robot_id, json.dumps(payload))
        return True
    except Exception as exc:
        logger.exception("setAirQuality failed for robot_id=%s: %s", robot_id, exc)
        return False

@mutation.field("setAgentList")
def resolve_set_agent_list(_, info, agent_list):
    agent_list_cache = ignite_client.get_or_create_cache('subscribed_agents')
    try:
        agent_list_cache.put(1, json.dumps(agent_list))
        return True
    except Exception as exc:
        logger.exception("setAgentList failed: %s", exc)
        return False
    
@mutation.field("setExitedAgentList")
def resolve_set_exited_agent_list(_, info, agent_list):
    agent_list_cache = ignite_client.get_or_create_cache('exited_agents')
    try:
        agent_list_cache.put(1, json.dumps(agent_list))
        return True
    except Exception as exc:
        logger.exception("setExitedAgentList failed: %s", exc)
        return False
    
@mutation.field("clearDetectedObjects")
def resolve_clear_detected_objects(_, info):
    detected_objects_cache = ignite_client.get_or_create_cache('detected_objects')
    try:
        detected_objects_cache.clear()
        return True
    except Exception as exc:
        logger.exception("clearDetectedObjects failed: %s", exc)
        return False
    
@mutation.field("setTransform")
def resolve_set_transform(_, info, R, t, timestamp):
    transform_cache = ignite_client.get_or_create_cache('transform')
    transform = {
        "R": R,
        "t": t,
        "timestamp": timestamp
    }
    try:
        transform_cache.put(1, json.dumps(transform))
        return True
    except Exception as exc:
        logger.exception("setTransform failed: %s", exc)
        return False
    
@mutation.field("setMap")
def resolve_set_map(_, info, data):
    map_cache = ignite_client.get_or_create_cache('map')

    array_bytes = base64.b64decode(data)
    try:
        map_cache.put(1, array_bytes)
        return True
    except Exception as exc:
        logger.exception("setMap failed: %s", exc)
        return False
    
@mutation.field("setMapMetadata")
def resolve_set_map_metdata(_, info, resolution, width, height, origin_pos_x, origin_pos_y, origin_pos_z, origin_ori_x, origin_ori_y, origin_ori_z, origin_ori_w):
    md_cache = ignite_client.get_or_create_cache('map_metadata')
    metadata = {
        "resolution": resolution,
        "width": width,
        "height": height,
        "origin.position.x": origin_pos_x,
        "origin.position.y": origin_pos_y,
        "origin.position.z": origin_pos_z,
        "origin.orientation.x": origin_ori_x,
        "origin.orientation.y": origin_ori_y,
        "origin.orientation.z": origin_ori_z,
        "origin.orientation.w": origin_ori_w
    }
    try:
        md_cache.put(1, json.dumps(metadata))
        return True
    except Exception as exc:
        logger.exception("setMapMetadata failed: %s", exc)
        return False
    
@mutation.field("setPath")
def resolve_set_path(_, info, robot_id, x, y, t):
    path_cache = ignite_client.get_or_create_cache('cmd_smoothed_path')
    path = {
        "x": x,
        "y": y,
        "t": t
    }
    try:
        path_cache.put(robot_id, json.dumps(path).encode('utf-8'))
        return True
    except Exception as exc:
        logger.exception("setPath failed for robot_id=%s: %s", robot_id, exc)
        return False
    
@mutation.field("setObjects")
def resolve_set_objects(_, info, agent_id, x, y, class_name, object_num):
    detected_objects_cache = ignite_client.get_or_create_cache('detected_objects')
    
    # Get existing objects
    detected_objects = detected_objects_cache.get(agent_id)

    if detected_objects is None:
        detected_objects = dict()
    else:
        detected_objects = json.loads(detected_objects)

    # Add new object
    detected_objects[object_num] = {
        "x": x,
        "y": y,
        "class_name": class_name
    }

    try:
        detected_objects_cache.put(agent_id, json.dumps(detected_objects))
        return True
    except Exception as exc:
        logger.exception("setObjects failed for agent_id=%s: %s", agent_id, exc)
        return False
    
@mutation.field("clearObject")
def resolve_clear_object(_, info, agent_id, object_num):
    detected_objects_cache = ignite_client.get_or_create_cache('detected_objects')

    detected_objects = detected_objects_cache.get(agent_id)
    if detected_objects is None:
        return False
    detected_objects = json.loads(detected_objects)

    if str(object_num) not in detected_objects:
        return False
    detected_objects.pop(str(object_num))
    try:
        detected_objects_cache.put(agent_id, json.dumps(detected_objects))
        return True
    except Exception as exc:
        logger.exception("clearObject failed for agent_id=%s: %s", agent_id, exc)
        return False
    
@mutation.field("clearAllObjects")
def resolve_clear_all_objects(_, info):
    detected_objects_cache = ignite_client.get_or_create_cache('detected_objects')
    try:
        detected_objects_cache.clear()
        return True
    except Exception as exc:
        logger.exception("clearAllObjects failed: %s", exc)
        return False