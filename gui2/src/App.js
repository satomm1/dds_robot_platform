import React, { useState } from 'react';
import './App.css';
import { ApolloProvider, useMutation } from '@apollo/client';
import client from './apolloClient';
import RobotMap from './components/RobotMap';
import RobotSelector from './components/RobotSelector';
import RobotControls from './components/RobotControls';
import RobotTypedGoals from './components/RobotTypedGoals';
import { SET_ROBOT_GOAL } from './mutations';

function App() {
  return (
    <ApolloProvider client={client}>
      <AppContent />
    </ApolloProvider>
  );
}

// Create a new component that's wrapped by ApolloProvider
function AppContent() {
  const [selectedRobotId, setSelectedRobotId] = useState('');

  // State for theta, if needed
  const [currentTheta, setCurrentTheta] = useState(0);
  
  // Now this hook is inside the ApolloProvider context
  const [setRobotGoal] = useMutation(SET_ROBOT_GOAL);
  
  const handleSetRobotGoal = (robotId, x, y) => {
    console.log(`Setting goal for robot ${robotId} to position (${x}, ${y}, ${currentTheta}°)`);
    
    const timestamp = new Date().getTime() / 1000; // Convert to seconds
    const theta_rad = (currentTheta * Math.PI) / 180; // Convert degrees to radians
    setRobotGoal({
      variables: {
        robotId: robotId,
        xGoal: x,
        yGoal: y,
        thetaGoal: theta_rad,
        timestamp: timestamp
      }
    }).catch(error => {
      console.error('Error setting robot goal:', error);
    });
  };

  const handleUpdateTheta = (robotId, thetaDegrees) => {
    console.log(`Updating orientation for robot ${robotId} to ${thetaDegrees}°`);
    
    // Flip the angle about the y-axis
    const flippedTheta = (180 - thetaDegrees) % 360;

    // Update the current theta value
    setCurrentTheta(flippedTheta);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Robot Control Interface</h1>
      </header>
      <div className="control-container">
        <div className="sidebar">
          <div style={{ overflowY: 'auto', maxHeight: '40%' }}>
            <RobotSelector 
              selectedRobotId={selectedRobotId} 
              onSelectRobot={setSelectedRobotId} 
            />
          </div>
          <hr className="sidebar-divider" style={{ 
            width: '100%', 
            border: '0', 
            height: '1px', 
            backgroundColor: '#ccc', 
            margin: '15px 0' 
          }} />
          <div style={{ overflowY: 'auto', maxHeight: '60%' }}>
            <RobotControls 
              selectedRobotId={selectedRobotId}  
            />
            <RobotTypedGoals
              selectedRobotId={selectedRobotId} 
              onSetGoal={handleUpdateTheta}
            />
          </div>
        </div>
        <div className="map-container">
          <RobotMap 
            selectedRobotId={selectedRobotId}
            onSetGoal={handleSetRobotGoal}
          />
        </div>
      </div>
    </div>
  );
}

export default App;