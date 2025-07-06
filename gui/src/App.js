import React, { useState } from 'react';
import './App.css';
import { ApolloProvider, useMutation } from '@apollo/client';
import client from './apolloClient';
import RobotMap from './components/RobotMap';
import RobotSelector from './components/RobotSelector';
import RobotControls from './components/RobotControls';
import RobotTypedGoals from './components/RobotTypedGoals';
import { SET_ROBOT_GOAL,  SET_ROBOT_INITIAL_POSITION} from './mutations';

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

  // State to manage position mode (goal or initial)
  // This can be used to toggle between setting a goal or an initial position
  const [positionMode, setPositionMode] = useState('goal'); // 'goal' or 'initial'

  // Mutation for setting the robot's initial position
  const [setRobotInitialPosition] = useMutation(SET_ROBOT_INITIAL_POSITION);
  
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

  const handleSetRobotInitialPosition = (robotId, x, y) => {
    console.log(`Setting initial position for robot ${robotId} to (${x}, ${y}, ${currentTheta}°)`);
    
    const timestamp = new Date().getTime() / 1000;
    const theta_rad = (currentTheta * Math.PI) / 180;
    setRobotInitialPosition({
      variables: {
        robotId: robotId,
        x: x,
        y: y,
        theta: theta_rad,
        timestamp: timestamp
      }
    }).catch(error => {
      console.error('Error setting robot initial position:', error);
    });
  };

  return (
    <div className="App">
      <header className="App-header">
        <h2 style={{ marginLeft: '30px' }}>Robot Controller</h2>
        <div style={{ fontSize: '14px', color: '#ccc', marginTop: '5px', marginRight: '30px' }}>
          Matthew Sato<br />
          Engineering Informatics Group<br />
          Stanford University
        </div>
      </header>
      <div className="control-container">
        <div className="sidebar">
          <div style={{ overflowY: 'auto', maxHeight: '40%' }}>
            <RobotSelector 
              selectedRobotId={selectedRobotId} 
              onSelectRobot={setSelectedRobotId} 
            />
          </div>
          <div className="mode-toggle">
            <button 
              className={positionMode === 'goal' ? 'btn-goal-init-active' : 'btn-goal-init-inactive'}
              onClick={() => setPositionMode('goal')}
            >
              Set Robot Goal
            </button>
            <button 
              className={positionMode === 'initial' ? 'btn-goal-init-active' : 'btn-goal-init-inactive'}
              onClick={() => setPositionMode('initial')}
            >
              Set Initial Position
            </button>
          </div>
          {/* <hr className="sidebar-divider" style={{ 
            width: '100%', 
            border: '0', 
            height: '1px', 
            backgroundColor: '#ccc', 
            margin: '10px 0' 
          }} /> */}
          <div style={{ overflowY: 'auto', maxHeight: '70%' }}>
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
            onSetInitialPosition={handleSetRobotInitialPosition}
            positionMode={positionMode}
          />
        </div>
      </div>
    </div>
  );
}

export default App;