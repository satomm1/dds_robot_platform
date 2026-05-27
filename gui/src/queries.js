import { gql } from '@apollo/client';

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

export const GET_SUBSCRIBED_AGENTS = gql`
  query {
    subscribed_agents {
      id
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
      goal_timestamp
      goal_valid
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

export const GET_AIR_QUALITIES = gql`
  query {
    airQualities {
      robot_id
      temperature
      relative_humidity
      voc_index
      nox_index
      timestamp
    }
  }
`;
