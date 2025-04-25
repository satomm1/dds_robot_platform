import React from 'react';

const RobotControls = ({ selectedRobot }) => {
  if (!selectedRobot) {
    return <div>No robot selected</div>;
  }

  return (
    <div className="robot-controls">
      <h3>Controls: {selectedRobot.name}</h3>
      <div className="control-stats">
        <p>Position: ({selectedRobot.x}, {selectedRobot.y})</p>
      </div>
      <div className="control-buttons">
        <button onClick={() => console.log('Stop robot')}>
          Stop
        </button>
        <button onClick={() => console.log('Reset position')}>
          Reset Position
        </button>
      </div>
    </div>
  );
};

export default RobotControls;
