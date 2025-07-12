// src/components/RobotSelector.js
import React from 'react';
import { useQuery } from '@apollo/client';
import { GET_ROBOT_POSITIONS } from '../queries';

const RobotSelector = ({ selectedRobotId, onSelectRobot }) => {
  // Query for robot list
  const { loading, error, data } = useQuery(GET_ROBOT_POSITIONS, {
    pollInterval: 5000, // Poll every 5 seconds to keep list updated
  });

  if (loading) return <div className="robot-selector">Loading robots...</div>;
  if (error) return <div className="robot-selector">Error loading robots: {error.message}</div>;
  
  const robots = data?.robotPositions || [];
  
  // If no robot is selected yet and we have robots, select the first one
  if (!selectedRobotId && robots.length > 0 && onSelectRobot) {
    setTimeout(() => onSelectRobot(robots[0].id), 0);
  }

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
              <span className="status-indicator" 
                    style={{ 
                      backgroundColor: robot.id === selectedRobotId ? 'green' : 'grey' 
                    }}>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default RobotSelector;