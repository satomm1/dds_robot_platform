// src/components/RobotControls.js
import React from 'react';
import { useMutation } from '@apollo/client';
import { REQUEST_ROBOT_STOP } from '../mutations';

const RobotControls = ({
  selectedRobotId,
  robotPositions = [],
  positionsLoading,
  positionsError,
}) => {
  const [requestRobotStop, { loading: stopLoading }] = useMutation(REQUEST_ROBOT_STOP);

  const selectedRobot = robotPositions.find((r) => r.id === selectedRobotId);

  if (selectedRobotId == null) {
    return <div className="robot-controls">No robot selected</div>;
  }

  if (positionsLoading && !selectedRobot) {
    return <div className="robot-controls">Loading robot data...</div>;
  }
  if (positionsError) {
    return <div className="robot-controls">Error: {positionsError.message}</div>;
  }
  if (!selectedRobot) {
    return <div className="robot-controls">Robot not found</div>;
  }

  const handleStop = () => {
    requestRobotStop({
      variables: { robotId: selectedRobotId },
    }).catch((error) => {
      console.error('Error requesting robot stop:', error);
    });
  };

  return (
    <div className="robot-controls">
      <h3>{selectedRobot.name || `Robot ${selectedRobot.id}`}</h3>
      <div className="control-stats">
        <p>
          <strong>Position:</strong> ({selectedRobot.x.toFixed(2)},{' '}
          {selectedRobot.y.toFixed(2)})
        </p>
        <p>
          <strong>Heading:</strong>{' '}
          {(selectedRobot.theta * (180 / Math.PI)).toFixed(1)}°
        </p>
      </div>
      <div className="control-buttons">
        <button
          type="button"
          onClick={handleStop}
          disabled={stopLoading}
          className="control-button stop"
        >
          Stop
        </button>
      </div>
    </div>
  );
};

export default RobotControls;
