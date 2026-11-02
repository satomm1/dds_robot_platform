from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber
from cyclonedds.pub import Publisher, DataWriter

import time

import json
import numpy as np
import requests
import signal
import os
import sys

from dds_utils import (
    AgentIdError,
    DataMessage,
    GraphqlPollBackoff,
    dds_log,
    create_domain_participant,
    dispose_participant,
    get_ip,
    reliable_qos,
    reliable_transient_local_command_qos,
    require_agent_id_int,
    MapTransformWatcher,
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
POLL_PERIOD_S = 0.2


# Everything the loop reads, in one request. Every field is nullable in the schema, so a
# failing resolver nulls only its own field (see parse_graphql_response(allow_partial=True)).
POLL_QUERY = """
query {
    robotGoals {
        id
        x_goal
        y_goal
        theta_goal
        goal_timestamp
        goal_valid
    }
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
    pendingRobotStops {
        id
        requested_at
    }
    pendingRobotShutdowns {
        id
        requested_at
    }
    robotInitialPositions {
        id
        x_init
        y_init
        theta_init
        init_timestamp
    }
}
"""

ROBOT_MCU_STATE_QUERY = """
query RobotMcuState($robotId: Int!) {
    robotMcuState(robot_id: $robotId) {
        mcu_connected
    }
}
"""

CONSUME_STOP_MUTATION = """
mutation ConsumeRobotStopRequest($robotId: Int!) {
    consumeRobotStopRequest(robot_id: $robotId)
}
"""

CONSUME_SHUTDOWN_MUTATION = """
mutation ConsumeRobotShutdownRequest($robotId: Int!) {
    consumeRobotShutdownRequest(robot_id: $robotId)
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
        # One keep-alive connection for the poll and its follow-up mutations (single thread).
        self._http = requests.Session()
        self._poll_warn = GraphqlPollBackoff()

        self.robot_goal_history = dict()
        self.robot_init_history = dict()
        self._mcu_block_logged = set()

        # Create a DomainParticipant, Subscriber, and Publisher
        self.participant = create_domain_participant(domain_qos=True)
        self.subscriber = Subscriber(self.participant)
        self.publisher = Publisher(self.participant)

        self.map_tf = None
        self._tf_watch = MapTransformWatcher(self.graphql_server, "goal_pub")

        # Writers live as long as the process: a writer deleted right after write() can drop the
        # sample before the robot has discovered the writer or acknowledged it.
        self._topics = {}
        self._target_data_writers = {}
        self._command_data_writers = {}
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
        if self.map_tf is None:
            return point
        return self.map_tf.apply(point, forward)

    def _topic(self, robot_id: int) -> Topic:
        if robot_id not in self._topics:
            self._topics[robot_id] = Topic(
                self.participant, data_topic_name(robot_id), DataMessage
            )
        return self._topics[robot_id]

    def _get_data_writer(self, robot_id: int, command: bool = False) -> DataWriter:
        """Goals, position_init and multi-robot goals use reliable_qos. Stop and shutdown
        (command=True) use the Lifespan QoS so a restarted robot is not replayed a stale one."""
        if command:
            writers, qos = self._command_data_writers, reliable_transient_local_command_qos
        else:
            writers, qos = self._target_data_writers, reliable_qos
        if robot_id not in writers:
            writers[robot_id] = DataWriter(self.publisher, self._topic(robot_id), qos=qos)
        return writers[robot_id]

    def _post(self, query, variables=None):
        return post_graphql(
            self.graphql_server, query, variables=variables, timeout=5, session=self._http
        )

    def _is_mcu_connected(self, robot_id: int) -> bool:
        """Quick Ignite/GraphQL check before sending position_init."""
        try:
            response = self._post(ROBOT_MCU_STATE_QUERY, variables={"robotId": int(robot_id)})
            data = parse_graphql_response(response)
            state = data.get("robotMcuState")
            return bool(state and state.get("mcu_connected"))
        except Exception:
            return False

    def _poll(self) -> dict:
        """One request for all five fields; {} if it fails, so nothing is published this tick."""
        try:
            response = self._post(POLL_QUERY)
            data = parse_graphql_response(response, allow_partial=True)
            errors = response.json().get("errors")
        except Exception as exc:
            self._poll_warn.failure("goal_pub", lambda exc=exc: f"poll failed: {exc}")
            return {}
        if errors:
            self._poll_warn.failure("goal_pub", lambda: f"poll returned errors: {errors}")
        else:
            self._poll_warn.success()
        return data

    def _maybe_publish_multi_robot_plan(self, current_time: int, plan):
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
            cr = self._post(CONSUME_MULTI_ROBOT_GOAL_PLAN_MUTATION)
            pdata = parse_graphql_response(cr)
            if not pdata.get("consumeMultiRobotGoalPlan"):
                raise RuntimeError("consumeMultiRobotGoalPlan returned false")
        except Exception as exc:
            dds_log(
                "goal_pub",
                f"consumeMultiRobotGoalPlan failed (DDS already sent; clear Ignite if needed): {exc}",
            )

    def _publish_goals(self, current_time: int, robot_goals):
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
            desired = (robot_goal_x, robot_goal_y, robot_goal_theta, robot_goal_timestamp)

            previous = self.robot_goal_history.get(robot_goal_id)
            if previous == desired:
                continue
            self.robot_goal_history[robot_goal_id] = desired

            # A goal first seen at startup is only sent if it is recent
            if previous is None and abs(current_time - robot_goal_timestamp) >= 10:
                continue

            goal_dict = {"x": robot_goal_x, "y": robot_goal_y, "theta": robot_goal_theta}
            command_message = DataMessage(MSG_GOAL, int(self.my_id), int(robot_goal_timestamp), json.dumps(goal_dict))
            self._get_data_writer(robot_goal_id).write(command_message)
            action = "set" if previous is None else "updated"
            dds_log(
                "goal_pub",
                f"goal {action} for robot {robot_goal_id} "
                f"(x={robot_goal_x:.3f}, y={robot_goal_y:.3f}, θ={robot_goal_theta:.3f})",
            )

    def _publish_pending_commands(self, current_time: int, pending, message_type, consume_mutation, label):
        """Pending human stop/shutdown requests -> DDS DataMessage, then mark them consumed."""
        try:
            for request in pending:
                rid = int(request["id"])
                ts = int(request.get("requested_at", current_time))
                payload = json.dumps({"source": "human"})
                command_message = DataMessage(message_type, int(self.my_id), ts, payload)
                self._get_data_writer(rid, command=True).write(command_message)
                dds_log("goal_pub", f"published {label} for robot {rid}")
                try:
                    cr = self._post(consume_mutation, variables={"robotId": rid})
                    parse_graphql_response(cr)
                except Exception:
                    pass
        except Exception:
            pass

    def _publish_initial_positions(self, current_time: int, robot_init):
        for robot in robot_init:
            robot_id = int(robot['id'])
            robot_x = robot['x_init']
            robot_y = robot['y_init']
            robot_theta = robot['theta_init']
            robot_timestamp = robot['init_timestamp']

            # Transform the initial position to the reference map
            robot_x, robot_y, robot_theta = self.transform_point(
                [robot_x, robot_y, robot_theta], forward=True
            )
            desired = (robot_x, robot_y, robot_theta, robot_timestamp)

            if robot_id not in self.robot_init_history:
                if abs(current_time - robot_timestamp) >= 10:
                    continue
            elif self.robot_init_history[robot_id] == desired:
                continue

            if not self._is_mcu_connected(robot_id):
                if robot_id not in self._mcu_block_logged:
                    self._mcu_block_logged.add(robot_id)
                    dds_log(
                        "goal_pub",
                        f"position_init blocked for robot {robot_id}: MCU not connected",
                    )
                continue

            init_dict = {"x": robot_x, "y": robot_y, "theta": robot_theta}
            command_message = DataMessage(
                MSG_POSITION_INIT,
                int(self.my_id),
                int(robot_timestamp),
                json.dumps(init_dict),
            )
            self._get_data_writer(robot_id).write(command_message)
            action = "updated" if robot_id in self.robot_init_history else "set"
            self.robot_init_history[robot_id] = desired
            self._mcu_block_logged.discard(robot_id)
            dds_log(
                "goal_pub",
                f"initial position {action} for robot {robot_id} "
                f"(x={robot_x:.3f}, y={robot_y:.3f}, θ={robot_theta:.3f})",
            )

    def _poll_once(self, current_time: int):
        data = self._poll()
        self._publish_goals(current_time, data.get("robotGoals") or [])
        self._maybe_publish_multi_robot_plan(current_time, data.get("activeMultiRobotGoalPlan"))
        self._publish_pending_commands(
            current_time, data.get("pendingRobotStops") or [], MSG_STOP, CONSUME_STOP_MUTATION, "stop"
        )
        self._publish_pending_commands(
            current_time,
            data.get("pendingRobotShutdowns") or [],
            MSG_ROBOT_SHUTDOWN,
            CONSUME_SHUTDOWN_MUTATION,
            "shutdown",
        )
        self._publish_initial_positions(current_time, data.get("robotInitialPositions") or [])

    def run(self):

        # Wait for a transform (prefers this session's; see MapTransformWatcher).
        self.map_tf = self._tf_watch.wait(max_wait_s=None)

        # Now start the main loop
        dds_log("goal_pub", "ready")
        while True:
            map_tf = self._tf_watch.refresh()
            if map_tf is not None:
                self.map_tf = map_tf

            try:
                self._poll_once(int(time.time()))
            except Exception:
                pass

            time.sleep(POLL_PERIOD_S)

    def shutdown(self):
        dds_log("goal_pub", "stopped")
        self._http.close()
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
