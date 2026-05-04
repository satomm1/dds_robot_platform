import React, { useEffect } from 'react';
import { getRobotColor } from '../utils';

const RobotSelector = ({
  selectedRobotId,
  onSelectRobot,
  robotPositions = [],
  positionsLoading,
  positionsError,
}) => {
  useEffect(() => {
    const robots = robotPositions;
    if (selectedRobotId == null && robots.length > 0 && onSelectRobot) {
      onSelectRobot(robots[0].id);
    }
  }, [selectedRobotId, robotPositions, onSelectRobot]);

  if (positionsLoading && robotPositions.length === 0) {
    return <div className="robot-selector">Loading robots...</div>;
  }
  if (positionsError) {
    return <div className="robot-selector">Error loading robots: {positionsError.message}</div>;
  }

  const robots = robotPositions;

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
