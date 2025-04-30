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