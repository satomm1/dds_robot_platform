import React from 'react';

const RobotSelector = ({ robots, selectedRobotId, onSelectRobot }) => {
  return (
    <div className="robot-selector">
      <h3>Select Robot</h3>
      <ul>
        {robots.map(robot => (
          <li 
            key={robot.id}
            className={robot.id === selectedRobotId ? 'selected' : ''}
            onClick={() => onSelectRobot(robot.id)}
          >
            {robot.name}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default RobotSelector;
