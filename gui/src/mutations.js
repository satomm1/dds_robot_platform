// src/mutations.js
import { gql } from '@apollo/client';

export const SET_ROBOT_GOAL = gql`
    mutation SetRobotGoal($robotId: Int!, $xGoal: Float!, $yGoal: Float!, $thetaGoal: Float!, $timestamp: Float!) {
        setRobotGoal(robot_id: $robotId, 
                     x_goal: $xGoal, 
                     y_goal: $yGoal, 
                     theta_goal: $thetaGoal, 
                     goal_timestamp: $timestamp)
}`;

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