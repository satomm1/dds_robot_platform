import React, { useEffect } from 'react';
import { useRobotColors } from '../hooks/useRobotColors';

const RobotSelector = ({
  selectedRobotId,
  onSelectRobot,
  robotPositions = [],
  positionsLoading,
  positionsError,
}) => {
  const { getRobotColor, setRobotColor } = useRobotColors();

  useEffect(() => {
    const robots = robotPositions;
    if (!onSelectRobot || robots.length === 0) return;

    const firstId = robots[0].id;
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
    return (
      <div className="robot-selector">Error loading robots: {positionsError.message}</div>
    );
  }

  const robots = robotPositions;

  return (
    <div className="robot-selector">
      <h3>Select Robot</h3>
      {robots.length === 0 ? (
        <p>No robots available</p>
      ) : (
        <ul>
          {robots.map((robot) => (
            <li
              key={robot.id}
              className={robot.id === selectedRobotId ? 'selected' : ''}
              onClick={() => onSelectRobot(robot.id)}
            >
              {robot.name || `Robot ${robot.id}`}
              <input
                type="color"
                className="robot-selector__color-input"
                value={getRobotColor(robot.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRobotColor(robot.id, e.target.value)}
                aria-label={`Color for ${robot.name || `Robot ${robot.id}`}`}
                title="Choose robot color"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RobotSelector;
