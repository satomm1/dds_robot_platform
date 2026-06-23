// src/mutations.js
import { gql } from '@apollo/client';

export const SET_MULTI_ROBOT_GOAL_PLAN = gql`
  mutation SetMultiRobotGoalPlan(
    $planId: String!
    $coordinated: Boolean!
    $planTimestamp: Float!
    $goals: [MultiRobotGoalInput!]!
  ) {
    setMultiRobotGoalPlan(
      plan_id: $planId
      coordinated: $coordinated
      plan_timestamp: $planTimestamp
      goals: $goals
    )
  }
`;

export const SET_ROBOT_GOAL = gql`
    mutation SetRobotGoal($robotId: Int!, $xGoal: Float!, $yGoal: Float!, $thetaGoal: Float!, $timestamp: Float!) {
        setRobotGoal(robot_id: $robotId, 
                     x_goal: $xGoal, 
                     y_goal: $yGoal, 
                     theta_goal: $thetaGoal, 
                     goal_timestamp: $timestamp,
                     from_bot: false,
                     goal_valid: true)
}`;

export const REQUEST_ROBOT_STOP = gql`
  mutation RequestRobotStop($robotId: Int!) {
    requestRobotStop(robot_id: $robotId)
  }
`;

export const REQUEST_ROBOT_SHUTDOWN = gql`
  mutation RequestRobotShutdown($robotId: Int!) {
    requestRobotShutdown(robot_id: $robotId)
  }
`;

export const CLEAR_ROBOT_PATH = gql`
  mutation ClearRobotPath($robotId: Int!) {
    clearRobotPath(robot_id: $robotId)
  }
`;

export const CLEAR_ALL_OBJECTS = gql`
    mutation ClearAllObjects {
        clearAllObjects
}`;

export const SET_ROBOT_INITIAL_POSITION = gql`
  mutation SetRobotInitialPosition($robotId: Int!, $x: Float!, $y: Float!, $theta: Float!, $timestamp: Float!) {
    setRobotInitialPosition(robot_id: $robotId, 
                            x_init: $x, 
                            y_init: $y, 
                            theta_init: $theta, 
                            init_timestamp: $timestamp) 
}`;

export const SET_MAP = gql`
  mutation SetMap($data: String!) {
    setMap(data: $data)
  }
`;

export const SET_MAP_METADATA = gql`
  mutation SetMapMetadata(
    $resolution: Float!
    $width: Int!
    $height: Int!
    $origin_pos_x: Float!
    $origin_pos_y: Float!
    $origin_pos_z: Float!
    $origin_ori_x: Float!
    $origin_ori_y: Float!
    $origin_ori_z: Float!
    $origin_ori_w: Float!
  ) {
    setMapMetadata(
      resolution: $resolution
      width: $width
      height: $height
      origin_pos_x: $origin_pos_x
      origin_pos_y: $origin_pos_y
      origin_pos_z: $origin_pos_z
      origin_ori_x: $origin_ori_x
      origin_ori_y: $origin_ori_y
      origin_ori_z: $origin_ori_z
      origin_ori_w: $origin_ori_w
    )
  }
`;