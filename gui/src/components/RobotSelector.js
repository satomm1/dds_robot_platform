import React, { useEffect } from 'react';
import { useQuery } from '@apollo/client';
import { GET_ROBOT_POSITIONS } from '../queries';
import { getRobotColor } from '../utils';

const RobotSelector = ({ selectedRobotId, onSelectRobot }) => {
  const { loading, error, data } = useQuery(GET_ROBOT_POSITIONS, {
    pollInterval: 5000,
  });

  useEffect(() => {
    const robots = data?.robotPositions ?? [];
    if (!selectedRobotId && robots.length > 0 && onSelectRobot) {
      onSelectRobot(robots[0].id);
    }
  }, [selectedRobotId, data?.robotPositions, onSelectRobot]);

  if (loading) return <div className="robot-selector">Loading robots...</div>;
  if (error) return <div className="robot-selector">Error loading robots: {error.message}</div>;

  const robots = data?.robotPositions || [];

  return (
    <div className="robot-selector">
      <h3>Select Robot</h3>
      {robots.length === 0 ? (
        <p>No robots available</p>
      ) : (
        <ul>
          {robots.map(robot => (
            <li
              key={robot.id}
              className={robot.id === selectedRobotId ? 'selected' : ''}
              onClick={() => onSelectRobot(robot.id)}
            >
              {robot.name || `Robot ${robot.id}`}
              <span
                className="status-indicator"
                style={{
                  backgroundColor: getRobotColor(robot.id),
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RobotSelector;
