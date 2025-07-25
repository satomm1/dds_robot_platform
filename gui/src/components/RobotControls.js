// src/components/RobotControls.js
import React from 'react';
import { useQuery, useMutation, gql } from '@apollo/client';
import { GET_ROBOT_POSITIONS } from '../queries';

// Mutation for stopping a robot
const STOP_ROBOT = gql`
  mutation StopRobot($robotId: ID!) {
    stopRobot(robotId: $robotId) {
      id
      status
    }
  }
`;

const RobotControls = ({ selectedRobotId }) => {
  // Query for selected robot details
  const { loading, error, data } = useQuery(GET_ROBOT_POSITIONS, {
    pollInterval: 2000, // Faster polling for active controls
    skip: !selectedRobotId
  });
  
  // Set up mutations
  const [stopRobot] = useMutation(STOP_ROBOT);
  
  // Find the selected robot from the data
  const selectedRobot = data?.robotPositions.find(r => r.id === selectedRobotId);
  
  if (!selectedRobotId) {
    return <div className="robot-controls">No robot selected</div>;
  }
  
  if (loading) return <div className="robot-controls">Loading robot data...</div>;
  if (error) return <div className="robot-controls">Error: {error.message}</div>;
  if (!selectedRobot) return <div className="robot-controls">Robot not found</div>;

  // Handler for stopping the robot
  const handleStop = () => {
    stopRobot({
      variables: { robotId: selectedRobotId }
    }).catch(error => {
      console.error('Error stopping robot:', error);
    });
  };
  
  return (
    <div className="robot-controls">
      <h3>{selectedRobot.name || `Robot ${selectedRobot.id}`}</h3>
      <div className="control-stats">
        <p><strong>Position:</strong> ({selectedRobot.x.toFixed(2)}, {selectedRobot.y.toFixed(2)})</p>
        <p><strong>Heading:</strong> {(selectedRobot.theta * (180/Math.PI)).toFixed(1)}°</p>
      </div>
      <div className="control-buttons">
        <button onClick={handleStop} className="control-button stop">
          Stop
        </button>
      </div>
    </div>
  );
};

export default RobotControls;