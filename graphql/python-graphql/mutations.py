from ariadne import load_schema_from_path, make_executable_schema, gql, MutationType
import json
import numpy as np

from ignite import ignite_client

mutation = MutationType()

@mutation.field("setRobotGoal")
def resolve_set_robot_goal(_, info, robot_id, x_goal, y_goal, theta_goal, goal_timestamp):
    goal_cache = ignite_client.get_or_create_cache('robot_goal')
    goal = {
        "x": x_goal,
        "y": y_goal,
        "theta": theta_goal,
        "timestamp": goal_timestamp
    }
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
    
@mutation.field("setAgentList")
def resolve_set_agent_list(_, info, agent_list):
    agent_list_cache = ignite_client.get_or_create_cache('subscribed_agents')
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