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
    if (!onSelectRobot || robots.length === 0) return;

    const firstId = robots[0].id;
    // Single robot in the environment: always select it (covers stale selection after others left).
    if (robots.length === 1) {
      if (selectedRobotId !== firstId) {
        onSelectRobot(firstId);
      }
      return;
    }

    if (selectedRobotId == null) {
      onSelectRobot(firstId);
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
