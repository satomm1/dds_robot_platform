from ariadne import load_schema_from_path, make_executable_schema, gql, MutationType
import json
import logging
import time
import numpy as np
import base64

from global_transform import require_global_transform
from ignite import cache_op
from objects_common import drop_stale
from se2 import transform_pose

mutation = MutationType()
logger = logging.getLogger(__name__)

STOP_REQUEST_CACHE = "robot_stop_request"
SHUTDOWN_REQUEST_CACHE = "robot_shutdown_request"
MULTI_ROBOT_GOAL_PLAN_CACHE = "multi_robot_goal_plan"
MULTI_ROBOT_GOAL_PLAN_ACTIVE_KEY = "active"
AIR_QUALITY_CACHE = "robot_air_quality"
MCU_STATE_CACHE = "robot_mcu_state"


@mutation.field("requestRobotStop")
def resolve_request_robot_stop(_, info, robot_id: int):
    payload = {
        "requested_at": time.time(),
        "pending": True,
    }
    try:
        cache_op(STOP_REQUEST_CACHE, lambda c: c.put(robot_id, json.dumps(payload)))
        try:
            cache_op("cmd_smoothed_path", lambda c: c.remove_key(robot_id))
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
    payload = {
        "requested_at": time.time(),
        "pending": True,
    }
    try:
        cache_op(SHUTDOWN_REQUEST_CACHE, lambda c: c.put(robot_id, json.dumps(payload)))
        try:
            cache_op("cmd_smoothed_path", lambda c: c.remove_key(robot_id))
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
    try:
        cache_op("cmd_smoothed_path", lambda c: c.remove_key(robot_id))
        return True
    except Exception as exc:
        logger.exception("clearRobotPath failed for robot_id=%s: %s", robot_id, exc)
        return False


@mutation.field("consumeRobotStopRequest")
def resolve_consume_robot_stop_request(_, info, robot_id: int):
    try:
        cache_op(STOP_REQUEST_CACHE, lambda c: c.remove_key(robot_id))
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
    try:
        cache_op(SHUTDOWN_REQUEST_CACHE, lambda c: c.remove_key(robot_id))
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
                cache_op("robot_goal", lambda c: c.remove_key(rid))
            except Exception:
                pass
        cache_op(MULTI_ROBOT_GOAL_PLAN_CACHE, lambda c: c.put(MULTI_ROBOT_GOAL_PLAN_ACTIVE_KEY, json.dumps(doc)))
        return True
    except Exception as exc:
        logger.exception("setMultiRobotGoalPlan failed: %s", exc)
        return False


@mutation.field("consumeMultiRobotGoalPlan")
def resolve_consume_multi_robot_goal_plan(_, info):
    try:
        cache_op(MULTI_ROBOT_GOAL_PLAN_CACHE, lambda c: c.remove_key(MULTI_ROBOT_GOAL_PLAN_ACTIVE_KEY))
        return True
    except Exception as exc:
        logger.debug("consumeMultiRobotGoalPlan: %s", exc)
        return False


@mutation.field("setRobotGoal")
def resolve_set_robot_goal(_, info, robot_id, x_goal, y_goal, theta_goal, goal_timestamp, from_bot=None, goal_valid=True):
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
        cache_op('robot_goal', lambda c: c.put(robot_id, json.dumps(goal)))
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
    position = {
        "x": x,
        "y": y,
        "theta": theta,
    }
    if position_timestamp is not None:
        position["position_timestamp"] = float(position_timestamp)
    try:
        cache_op('robot_position', lambda c: c.put(robot_id, json.dumps(position)))
        return True
    except Exception as exc:
        logger.exception("setRobotPosition failed for robot_id=%s: %s", robot_id, exc)
        return False    
@mutation.field("setRobotInitialPosition")
def resolve_set_robot_initial_position(_, info, robot_id, x_init, y_init, theta_init, init_timestamp):
    position = {
        "x": x_init,
        "y": y_init,
        "theta": theta_init,
        "timestamp": init_timestamp
    }
    try:
        cache_op('robot_initial_position', lambda c: c.put(robot_id, json.dumps(position)))
        return True
    except Exception as exc:
        logger.exception("setRobotInitialPosition failed for robot_id=%s: %s", robot_id, exc)
        return False
    
@mutation.field("clearRobotPosition")
def resolve_clear_robot_position(_, info, robot_id):
    try:
        cache_op('robot_position', lambda c: c.remove_key(robot_id))
        return True
    except Exception as exc:
        logger.exception("clearRobotPosition failed for robot_id=%s: %s", robot_id, exc)
        return False
    
@mutation.field("clearRobot")
def resolve_clear_robot(_, info, robot_id):
    try:
        cache_op('robot_position', lambda c: c.remove_key(robot_id))
        cache_op('cmd_smoothed_path', lambda c: c.remove_key(robot_id))
        cache_op('robot_goal', lambda c: c.remove_key(robot_id))
        for name in (STOP_REQUEST_CACHE, SHUTDOWN_REQUEST_CACHE, AIR_QUALITY_CACHE, MCU_STATE_CACHE):
            try:
                cache_op(name, lambda c: c.remove_key(robot_id))
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
    payload = {
        "temperature": float(temperature),
        "relative_humidity": float(relative_humidity),
        "voc_index": float(voc_index),
        "nox_index": float(nox_index),
        "timestamp": float(timestamp),
    }
    try:
        cache_op(AIR_QUALITY_CACHE, lambda c: c.put(robot_id, json.dumps(payload)))
        return True
    except Exception as exc:
        logger.exception("setAirQuality failed for robot_id=%s: %s", robot_id, exc)
        return False


@mutation.field("setRobotMcuState")
def resolve_set_robot_mcu_state(
    _,
    info,
    robot_id,
    mcu_connected,
    location_valid,
    timestamp,
):
    payload = {
        "mcu_connected": bool(mcu_connected),
        "location_valid": bool(location_valid),
        "timestamp": float(timestamp),
    }
    try:
        cache_op(MCU_STATE_CACHE, lambda c: c.put(robot_id, json.dumps(payload)))
        return True
    except Exception as exc:
        logger.exception("setRobotMcuState failed for robot_id=%s: %s", robot_id, exc)
        return False

@mutation.field("setAgentList")
def resolve_set_agent_list(_, info, agent_list):
    try:
        cache_op('subscribed_agents', lambda c: c.put(1, json.dumps(agent_list)))
        return True
    except Exception as exc:
        logger.exception("setAgentList failed: %s", exc)
        return False
    
@mutation.field("setExitedAgentList")
def resolve_set_exited_agent_list(_, info, agent_list):
    try:
        cache_op('exited_agents', lambda c: c.put(1, json.dumps(agent_list)))
        return True
    except Exception as exc:
        logger.exception("setExitedAgentList failed: %s", exc)
        return False
    
@mutation.field("clearDetectedObjects")
def resolve_clear_detected_objects(_, info):
    try:
        cache_op('detected_objects', lambda c: c.clear())
        return True
    except Exception as exc:
        logger.exception("clearDetectedObjects failed: %s", exc)
        return False
    
TRANSFORM_MODELS = ("rigid", "tps")
TPS_MIN_POINT_PAIRS = 4


@mutation.field("setTransform")
def resolve_set_transform(_, info, R, t, timestamp, model=None, src_points=None, dst_points=None, smooth=None):
    model = model or "rigid"
    if model not in TRANSFORM_MODELS:
        raise ValueError(f"setTransform: model must be one of {TRANSFORM_MODELS}, got {model!r}")
    transform = {
        "R": R,
        "t": t,
        "timestamp": timestamp,
        "model": model,
    }
    if model == "tps":
        src_points = src_points or []
        dst_points = dst_points or []
        if len(src_points) != len(dst_points) or len(src_points) % 2:
            raise ValueError("setTransform: src_points and dst_points must be equal-length flattened [x, y, ...] lists")
        if len(src_points) < 2 * TPS_MIN_POINT_PAIRS:
            raise ValueError(f"setTransform: tps needs at least {TPS_MIN_POINT_PAIRS} point pairs")
        transform["src_points"] = src_points
        transform["dst_points"] = dst_points
        transform["smooth"] = float(smooth or 0.0)
    try:
        cache_op('transform', lambda c: c.put(1, json.dumps(transform)))
        return True
    except Exception as exc:
        logger.exception("setTransform failed: %s", exc)
        return False
    
@mutation.field("setMap")
def resolve_set_map(_, info, data):
    array_bytes = base64.b64decode(data)
    try:
        cache_op('map', lambda c: c.put(1, array_bytes))
        return True
    except Exception as exc:
        logger.exception("setMap failed: %s", exc)
        return False
    
@mutation.field("setMapMetadata")
def resolve_set_map_metdata(_, info, resolution, width, height, origin_pos_x, origin_pos_y, origin_pos_z, origin_ori_x, origin_ori_y, origin_ori_z, origin_ori_w):
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
        cache_op('map_metadata', lambda c: c.put(1, json.dumps(metadata)))
        return True
    except Exception as exc:
        logger.exception("setMapMetadata failed: %s", exc)
        return False
    
@mutation.field("setPath")
def resolve_set_path(_, info, robot_id, x, y, t):
    path = {
        "x": x,
        "y": y,
        "t": t
    }
    try:
        cache_op('cmd_smoothed_path', lambda c: c.put(robot_id, json.dumps(path).encode('utf-8')))
        return True
    except Exception as exc:
        logger.exception("setPath failed for robot_id=%s: %s", robot_id, exc)
        return False
    
@mutation.field("setObjects")
def resolve_set_objects(_, info, agent_id, x, y, class_name, object_num, timestamp=None):
    # Get existing objects
    detected_objects = cache_op('detected_objects', lambda c: c.get(agent_id))

    if detected_objects is None:
        detected_objects = dict()
    else:
        # Writers prune stale detections; objectPositions only filters them on read.
        detected_objects = drop_stale(json.loads(detected_objects), time.time())

    entry = {
        "x": x,
        "y": y,
        "class_name": class_name,
    }
    if timestamp is not None:
        entry["timestamp"] = float(timestamp)

    detected_objects[object_num] = entry

    try:
        cache_op('detected_objects', lambda c: c.put(agent_id, json.dumps(detected_objects)))
        return True
    except Exception as exc:
        logger.exception("setObjects failed for agent_id=%s: %s", agent_id, exc)
        return False
    
@mutation.field("clearObject")
def resolve_clear_object(_, info, agent_id, object_num):
    detected_objects = cache_op('detected_objects', lambda c: c.get(agent_id))
    if detected_objects is None:
        return False
    detected_objects = json.loads(detected_objects)

    if str(object_num) not in detected_objects:
        return False
    detected_objects.pop(str(object_num))
    detected_objects = drop_stale(detected_objects, time.time())
    try:
        cache_op('detected_objects', lambda c: c.put(agent_id, json.dumps(detected_objects)))
        return True
    except Exception as exc:
        logger.exception("clearObject failed for agent_id=%s: %s", agent_id, exc)
        return False
    
@mutation.field("setLedgerObjects")
def resolve_set_ledger_objects(_, info, objects):
    """Replace the fleet ledger snapshot (JSON array) published by dds/observation_ledger.py."""
    try:
        json.loads(objects)
        cache_op('ledger_objects', lambda c: c.put(1, objects))
        return True
    except Exception as exc:
        logger.exception("setLedgerObjects failed: %s", exc)
        return False

@mutation.field("clearAllObjects")
def resolve_clear_all_objects(_, info):
    try:
        cache_op('detected_objects', lambda c: c.clear())
        return True
    except Exception as exc:
        logger.exception("clearAllObjects failed: %s", exc)
        return False