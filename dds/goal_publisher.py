from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber
from cyclonedds.pub import Publisher, DataWriter

import time

import json
import numpy as np
import signal
import os
import sys

from dds_utils import (
    AgentIdError,
    DataMessage,
    dds_log,
    create_domain_participant,
    dispose_participant,
    get_ip,
    reliable_qos,
    reliable_transient_local_command_qos,
    require_agent_id_int,
    transform_se2,
)
from dds_utils.config import resolve_graphql_http_url
from dds_utils.gql_subscriber_sync import parse_graphql_response, post_graphql
from dds_utils.topics import data_topic_name
from dds_utils.message_types import (
    MSG_GOAL,
    MSG_MULTI_ROBOT_GOAL,
    MSG_POSITION_INIT,
    MSG_ROBOT_SHUTDOWN,
    MSG_STOP,
)

INTER_DDS_WRITE_SLEEP_S = 0.02

ROBOT_GOALS_QUERY = """
                    query {
                        robotGoals {
                            id
                            x_goal
                            y_goal
                            theta_goal
                            goal_timestamp
                            goal_valid
                        }
                    }
                    """

ROBOT_INITIAL_POSITIONS_QUERY = """
                            query {
                                robotInitialPositions {
                                    id
                                    x_init
                                    y_init
                                    theta_init
                                    init_timestamp
                                }
                            }
                            """

TRANSFORMATION_MATRIX_QUERY = """
                            query {
                                transform {
                                    R
                                    t
                                    timestamp
                                }
                            }
                            """

PENDING_STOPS_QUERY = """
query {
    pendingRobotStops {
        id
        requested_at
    }
}
"""

CONSUME_STOP_MUTATION = """
mutation ConsumeRobotStopRequest($robotId: Int!) {
    consumeRobotStopRequest(robot_id: $robotId)
}
"""

PENDING_SHUTDOWN_QUERY = """
query {
    pendingRobotShutdowns {
        id
        requested_at
    }
}
"""

CONSUME_SHUTDOWN_MUTATION = """
mutation ConsumeRobotShutdownRequest($robotId: Int!) {
    consumeRobotShutdownRequest(robot_id: $robotId)
}
"""

ACTIVE_MULTI_ROBOT_GOAL_PLAN_QUERY = """
query {
    activeMultiRobotGoalPlan {
        plan_id
        coordinated
        plan_timestamp
        goals {
            robot_id
            x_goal
            y_goal
            theta_goal
        }
    }
}
"""

CONSUME_MULTI_ROBOT_GOAL_PLAN_MUTATION = """
mutation {
    consumeMultiRobotGoalPlan
}
"""


class GoalWriter:
    def __init__(self, my_id, server_url=None):

        self.my_id = my_id

        self.my_ip = get_ip()
        self.graphql_server = resolve_graphql_http_url(my_ip=self.my_ip, server_url=server_url)

        self.robot_goal_history = dict()
        self.robot_init_history = dict()

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = create_domain_participant(domain_qos=True)
        self.subscriber = Subscriber(self.participant)
        self.publisher = Publisher(self.participant)

        self.R = None
        self.t = None

        self._target_data_writers = {}
        self._last_multi_plan_key = None

    def transform_point(self, point, forward=True):
        """
        Transforms a point from the current map to the reference map or vice versa

        Parameters:
        - point (tuple): The point to be transformed.
        - forward (bool): True if transforming from current map to reference map, False otherwise.

        Returns:
        - tuple: The transformed point.
        """
        return transform_se2(self.R, self.t, point, forward)

    def _get_data_writer(self, robot_id: int) -> DataWriter:
        if robot_id not in self._target_data_writers:
            message_topic = Topic(
                self.participant, data_topic_name(robot_id), DataMessage
            )
            self._target_data_writers[robot_id] = DataWriter(
                self.publisher, message_topic, qos=reliable_qos
            )
        return self._target_data_writers[robot_id]

    def _maybe_publish_multi_robot_plan(self, current_time: int):
        try:
            response = post_graphql(
                self.graphql_server, ACTIVE_MULTI_ROBOT_GOAL_PLAN_QUERY, timeout=5
            )
            data = parse_graphql_response(response)
            plan = data.get("activeMultiRobotGoalPlan")
        except Exception:
            plan = None

        if not plan or not plan.get("goals"):
            self._last_multi_plan_key = None
            return

        key = (str(plan.get("plan_id", "")), float(plan.get("plan_timestamp", 0.0)))
        if key == self._last_multi_plan_key:
            return

        goals = plan["goals"]
        fleet_ids = [int(g["robot_id"]) for g in goals]
        plan_id = str(plan.get("plan_id", ""))
        coordinated = bool(plan.get("coordinated", True))
        ts = int(float(plan.get("plan_timestamp", current_time)))

        for entry in goals:
            rid = int(entry["robot_id"])
            gx = float(entry["x_goal"])
            gy = float(entry["y_goal"])
            gth = float(entry["theta_goal"])
            tx, ty, tth = self.transform_point([gx, gy, gth], forward=True)
            payload = {
                "x": float(tx),
                "y": float(ty),
                "theta": float(tth),
                "plan_id": plan_id,
                "coordinated": coordinated,
                "target_agent": rid,
                "fleet_robot_ids": fleet_ids,
            }
            command_message = DataMessage(
                MSG_MULTI_ROBOT_GOAL,
                int(self.my_id),
                ts,
                json.dumps(payload),
            )
            self._get_data_writer(rid).write(command_message)
            dds_log(
                "goal_pub",
                f"multi_robot_goal -> robot {rid} plan_id={plan_id} "
                f"(x={tx:.3f}, y={ty:.3f}, θ={tth:.3f}) fleet={fleet_ids}",
            )
            time.sleep(INTER_DDS_WRITE_SLEEP_S)

        self._last_multi_plan_key = key
        try:
            cr = post_graphql(
                self.graphql_server,
                CONSUME_MULTI_ROBOT_GOAL_PLAN_MUTATION,
                timeout=5,
            )
            pdata = parse_graphql_response(cr)
            if not pdata.get("consumeMultiRobotGoalPlan"):
                raise RuntimeError("consumeMultiRobotGoalPlan returned false")
        except Exception as exc:
            dds_log(
                "goal_pub",
                f"consumeMultiRobotGoalPlan failed (DDS already sent; clear Ignite if needed): {exc}",
            )

    def run(self):

        # First make sure we have the transformation matrix
        while self.R is None:
            try:
                response = post_graphql(self.graphql_server, TRANSFORMATION_MATRIX_QUERY, timeout=5)
                data = parse_graphql_response(response)
                transform = data.get("transform", {})
                timestamp = transform.get("timestamp", 0)
                if time.time() - timestamp > 10:
                    time.sleep(1)
                    continue
                R = transform.get("R", [])
                t = transform.get("t", [])
                if len(R) == 4 and len(t) == 2:
                    self.R = np.array(R).reshape((2, 2))
                    self.t = np.array(t)
                    break
            except Exception:
                time.sleep(1)

        # Now start the main loop
        dds_log("goal_pub", "ready")
        while True:
            try:
                current_time = int(time.time())

                # Query for any robot goals
                try:
                    response = post_graphql(self.graphql_server, ROBOT_GOALS_QUERY, timeout=5)
                    data = parse_graphql_response(response)
                    robot_goals = data.get("robotGoals", [])
                except Exception:
                    robot_goals = []

                for robot_goal in robot_goals:
                    robot_goal_id = int(robot_goal['id'])
                    robot_goal_x = robot_goal['x_goal']
                    robot_goal_y = robot_goal['y_goal']
                    robot_goal_theta = robot_goal['theta_goal']
                    robot_goal_timestamp = robot_goal['goal_timestamp']
                    robot_goal_valid = robot_goal.get('goal_valid', True)

                    if not robot_goal_valid:
                        # Skip invalid goals
                        continue

                    # Transform the goal to the reference map
                    robot_goal_x, robot_goal_y, robot_goal_theta = self.transform_point([robot_goal_x, robot_goal_y, robot_goal_theta], forward=True)

                    if robot_goal_id not in self.robot_goal_history:
                        # Store goal in history
                        self.robot_goal_history[robot_goal_id] = (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp)

                        # Check if the goal is recent
                        if abs(current_time - robot_goal_timestamp) < 10:

                            # Send the goal to the robot
                            goal_dict = {"x": robot_goal_x, "y": robot_goal_y, "theta": robot_goal_theta}
                            command_message = DataMessage(MSG_GOAL, int(self.my_id), int(robot_goal_timestamp), json.dumps(goal_dict))
                            message_topic = Topic(self.participant, data_topic_name(robot_goal_id), DataMessage)
                            message_writer = DataWriter(self.publisher, message_topic, qos=reliable_qos)
                            message_writer.write(command_message)
                            dds_log(
                                "goal_pub",
                                f"goal set for robot {robot_goal_id} "
                                f"(x={robot_goal_x:.3f}, y={robot_goal_y:.3f}, θ={robot_goal_theta:.3f})",
                            )
                    elif self.robot_goal_history[robot_goal_id] != (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp):

                        # Store goal in history
                        self.robot_goal_history[robot_goal_id] = (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp)
                        goal_dict = {"x": robot_goal_x, "y": robot_goal_y, "theta": robot_goal_theta}
                        command_message = DataMessage(MSG_GOAL, int(self.my_id), int(robot_goal_timestamp), json.dumps(goal_dict))
                        message_topic = Topic(self.participant, data_topic_name(robot_goal_id), DataMessage)
                        message_writer = DataWriter(self.publisher, message_topic, qos=reliable_qos)

                        message_writer.write(command_message)
                        dds_log(
                            "goal_pub",
                            f"goal updated for robot {robot_goal_id} "
                            f"(x={robot_goal_x:.3f}, y={robot_goal_y:.3f}, θ={robot_goal_theta:.3f})",
                        )

                self._maybe_publish_multi_robot_plan(current_time)

                # Pending human stop requests -> DDS DataMessage(stop)
                try:
                    response = post_graphql(self.graphql_server, PENDING_STOPS_QUERY, timeout=5)
                    pdata = parse_graphql_response(response)
                    for stop in pdata.get("pendingRobotStops", []) or []:
                        rid = int(stop["id"])
                        ts = int(stop.get("requested_at", current_time))
                        stop_payload = json.dumps({"source": "human"})
                        command_message = DataMessage(
                            MSG_STOP, int(self.my_id), ts, stop_payload
                        )
                        message_topic = Topic(
                            self.participant, data_topic_name(rid), DataMessage
                        )
                        message_writer = DataWriter(
                            self.publisher, message_topic, qos=reliable_transient_local_command_qos
                        )
                        message_writer.write(command_message)
                        dds_log("goal_pub", f"published stop for robot {rid}")
                        try:
                            cr = post_graphql(
                                self.graphql_server,
                                CONSUME_STOP_MUTATION,
                                variables={"robotId": rid},
                                timeout=5,
                            )
                            parse_graphql_response(cr)
                        except Exception:
                            pass
                except Exception:
                    pass

                # Pending human shutdown requests -> DDS DataMessage(robot_shutdown)
                try:
                    response = post_graphql(
                        self.graphql_server, PENDING_SHUTDOWN_QUERY, timeout=5
                    )
                    pdata = parse_graphql_response(response)
                    for shutdown in pdata.get("pendingRobotShutdowns", []) or []:
                        rid = int(shutdown["id"])
                        ts = int(shutdown.get("requested_at", current_time))
                        shutdown_payload = json.dumps({"source": "human"})
                        command_message = DataMessage(
                            MSG_ROBOT_SHUTDOWN, int(self.my_id), ts, shutdown_payload
                        )
                        message_topic = Topic(
                            self.participant, data_topic_name(rid), DataMessage
                        )
                        message_writer = DataWriter(
                            self.publisher, message_topic, qos=reliable_transient_local_command_qos
                        )
                        message_writer.write(command_message)
                        dds_log("goal_pub", f"published shutdown for robot {rid}")
                        try:
                            cr = post_graphql(
                                self.graphql_server,
                                CONSUME_SHUTDOWN_MUTATION,
                                variables={"robotId": rid},
                                timeout=5,
                            )
                            parse_graphql_response(cr)
                        except Exception:
                            pass
                except Exception:
                    pass

                # Query for any robot initial positions
                try:
                    response = post_graphql(
                        self.graphql_server, ROBOT_INITIAL_POSITIONS_QUERY, timeout=5
                    )
                    data = parse_graphql_response(response)
                    robot_init = data.get("robotInitialPositions", [])
                except Exception:
                    robot_init = []

                for robot in robot_init:
                    robot_id = int(robot['id'])
                    robot_x = robot['x_init']
                    robot_y = robot['y_init']
                    robot_theta = robot['theta_init']
                    robot_timestamp = robot['init_timestamp']

                    # Transform the initial position to the reference map
                    robot_x, robot_y, robot_theta = self.transform_point([robot_x, robot_y, robot_theta], forward=True)

                    if robot_id not in self.robot_init_history:
                        # Store initial position in history
                        self.robot_init_history[robot_id] = (robot_x, robot_y, robot_theta, robot_timestamp)

                        # Check if the initial position is recent
                        if abs(current_time - robot_timestamp) < 10:

                            # Send the initial position to the robot
                            init_dict = {"x": robot_x, "y": robot_y, "theta": robot_theta}
                            command_message = DataMessage(MSG_POSITION_INIT, int(self.my_id), int(robot_timestamp), json.dumps(init_dict))
                            message_topic = Topic(self.participant, data_topic_name(robot_id), DataMessage)
                            message_writer = DataWriter(self.publisher, message_topic, qos=reliable_qos)
                            message_writer.write(command_message)
                            dds_log(
                                "goal_pub",
                                f"initial position set for robot {robot_id} "
                                f"(x={robot_x:.3f}, y={robot_y:.3f}, θ={robot_theta:.3f})",
                            )
                    elif self.robot_init_history[robot_id] != (robot_x, robot_y, robot_theta, robot_timestamp):
                        # Store initial position in history
                        self.robot_init_history[robot_id] = (robot_x, robot_y, robot_theta, robot_timestamp)
                        init_dict = {"x": robot_x, "y": robot_y, "theta": robot_theta}
                        command_message = DataMessage(MSG_POSITION_INIT, int(self.my_id), int(robot_timestamp), json.dumps(init_dict))
                        message_topic = Topic(self.participant, data_topic_name(robot_id), DataMessage)
                        message_writer = DataWriter(self.publisher, message_topic, qos=reliable_qos)

                        message_writer.write(command_message)
                        dds_log(
                            "goal_pub",
                            f"initial position updated for robot {robot_id} "
                            f"(x={robot_x:.3f}, y={robot_y:.3f}, θ={robot_theta:.3f})",
                        )

            except Exception:
                # print("No goals yet...", e)
                pass

            time.sleep(0.2)

    def shutdown(self):
        dds_log("goal_pub", "stopped")
        self.subscriber = None
        self.publisher = None
        dispose_participant(self.participant)
        self.participant = None

if __name__ == '__main__':

    try:
        agent_id = require_agent_id_int()
    except AgentIdError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)

    goal_writer = GoalWriter(agent_id)

    def handle_signal(sig, frame):
        goal_writer.shutdown()
        exit(0)

    # Set up signal handlers for SIGINT (Ctrl+C) and SIGTERM
    signal.signal(signal.SIGTERM, handle_signal) # Handles termination signal

    time.sleep(10)  # Wait for the participant to do entry and initialization
    try:
        goal_writer.run()
    except KeyboardInterrupt:
        dds_log("goal_pub", "exiting")
        exit(0)
