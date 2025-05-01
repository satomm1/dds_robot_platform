from ariadne import load_schema_from_path, make_executable_schema, gql, MutationType
import json
import numpy as np
import base64

from ignite import ignite_client

mutation = MutationType()

@mutation.field("setRobotGoal")
def resolve_set_robot_goal(_, info, robot_id, x_goal, y_goal, theta_goal, goal_timestamp, from_bot=None):
    goal_cache = ignite_client.get_or_create_cache('robot_goal')
    goal = {
        "x": x_goal,
        "y": y_goal,
        "theta": theta_goal,
        "timestamp": goal_timestamp
    }
    if from_bot is not None:
        goal["from_bot"] = from_bot
    try:
        goal_cache.put(robot_id, json.dumps(goal))
        return True
    except:
        return False
    
@mutation.field("setRobotPosition")
def resolve_set_robot_position(_, info, robot_id, x, y, theta):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    position = {
        "x": x,
        "y": y,
        "theta": theta
    }
    try:
        position_cache.put(robot_id, json.dumps(position))
        return True
    except:
        return False
    
@mutation.field("clearRobotPosition")
def resolve_clear_robot_position(_, info, robot_id):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    try:
        position_cache.remove_key(robot_id)
        return True
    except:
        return False
    
@mutation.field("clearRobot")
def resolve_clear_robot(_, info, robot_id):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    path_cache = ignite_client.get_or_create_cache('cmd_smoothed_path')
    goal_cache = ignite_client.get_or_create_cache('robot_goal')
    try:
        position_cache.remove_key(robot_id)
        path_cache.remove_key(robot_id)
        goal_cache.remove_key(robot_id)
        return True
    except:
        return False
    
@mutation.field("setAgentList")
def resolve_set_agent_list(_, info, agent_list):
    agent_list_cache = ignite_client.get_or_create_cache('subscribed_agents')
    try:
        agent_list_cache.put(1, json.dumps(agent_list))
        return True
    except:
        return False
    
@mutation.field("setExitedAgentList")
def resolve_set_exited_agent_list(_, info, agent_list):
    agent_list_cache = ignite_client.get_or_create_cache('exited_agents')
    try:
        agent_list_cache.put(1, json.dumps(agent_list))
        return True
    except:
        return False
    
@mutation.field("clearDetectedObjects")
def resolve_clear_detected_objects(_, info):
    detected_objects_cache = ignite_client.get_or_create_cache('detected_objects')
    try:
        detected_objects_cache.clear()
        return True
    except:
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
    except:
        return False
    
@mutation.field("setMap")
def resolve_set_map(_, info, data):
    map_cache = ignite_client.get_or_create_cache('map')

    array_bytes = base64.b64decode(data)
    try:
        map_cache.put(1, array_bytes)
        return True
    except:
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
    except:
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
    except:
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
    except:
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
    except:
        return False