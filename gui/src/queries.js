// src/queries.js
import { gql } from '@apollo/client';

export const GET_MAP_WIDTH = gql`
  query GetMapWidth {
    map {
      width
      height
    }
  }
`;

export const GET_OCCUPANCY_GRID = gql`
    query { 
        map {
            width
            height
            resolution
            occupancy
        }
    }
`;

export const GET_ROBOT_POSITION = gql`
    query {
        robotPosition(robot_id: 1) {
            x
            y
            theta
        }
    }
`;

export const GET_ROBOT_POSITIONS = gql`
    query {
        robotPositions {
            id
            x
            y
            theta
        }
    }
`;

export const GET_ROBOT_GOALS = gql`
    query {
        robotGoals {
            id
            x_goal
            y_goal
            theta_goal
        }
    }
`;

export const GET_ROBOT_PATHS = gql`
    query {
        robotPaths {
            id
            x
            y
        }
    }
`;

export const GET_OBJECT_POSITIONS = gql`
    query {
        objectPositions {
            id
            x
            y
            type
        }
    }
`;