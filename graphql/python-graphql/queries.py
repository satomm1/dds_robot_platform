from ariadne import load_schema_from_path, make_executable_schema, gql, QueryType
import json
import numpy as np

from ignite import ignite_client

md_cache = ignite_client.get_or_create_cache('map_metadata')
map_cache = ignite_client.get_or_create_cache('map')
query = QueryType()

@query.field("map")
def resolve_data(*_):
    md = md_cache.get(1)
    map = map_cache.get(1)
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

@query.field("robotPosition")
def resolve_data(*_, robot_id: int):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    robot = position_cache.get(robot_id)
    if robot is None:
        return {
            "x": None,
            "y": None,
            "theta": None
        }
    robot = json.loads(robot)
    return {
        "x": robot["x"],
        "y": robot["y"],
        "theta": robot["theta"]
    }

@query.field("robotPositions")
def resolve_data(*_):
    position_cache = ignite_client.get_or_create_cache('robot_position')
    robots = position_cache.scan()
    all_robots = []
    for robot in robots:
        robot_id = robot[0]
        robot = json.loads(robot[1])
        all_robots.append({
            "id": robot_id,
            "x": robot["x"],
            "y": robot["y"],
            "theta": robot["theta"]
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
            "goal_timestamp": None
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
        "goal_from_bot": from_bot
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
            "goal_timestamp": goal["timestamp"]
        })
    return all_goals

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
    robot = json.loads(robot)
    print(robot)
    return {
        "id": int(robot["robot_id"]),
        "ranges": robot["ranges"],
        "range_min": robot["range_min"],
        "range_max": robot["range_max"],
        "angle_min": robot["angle_min"],
        "angle_max": robot["angle_max"],
        "angle_increment": robot["angle_increment"],
        "timestamp": robot["timestamp"]
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

@query.field("objectPositions")
def resolve_data(*_):
    position_cache = ignite_client.get_or_create_cache('detected_objects')
    objects = position_cache.scan()
    all_objects = []

    id = 0
    for obj in objects:
        obj_id = int(obj[0])
        obj = json.loads(obj[1])
        
        for key in obj.keys():
            object = obj[key]
            all_objects.append({
                "id": id,
                "x": object["x"],
                "y": object["y"],
                "type": object["class_name"]
            })
            id += 1
    return all_objects

@query.field("transform")
def resolve_data(*_):
    transform_cache = ignite_client.get_or_create_cache('transform')
    transform = transform_cache.get(1)
    if transform is None:
        return {
            "R": [0],
            "t": [0],
            "timestamp": 0
        }
    
    transform = json.loads(transform)
    return {
        "R": transform["R"],
        "t": transform["t"],
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