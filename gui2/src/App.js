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
  
  // Now this hook is inside the ApolloProvider context
  const [setRobotGoal, { loading: goalLoading, error: goalError }] = useMutation(SET_ROBOT_GOAL);
  
  const handleSetRobotGoal = (robotId, x, y) => {
    console.log(`Setting goal for robot ${robotId} to position (${x}, ${y})`);
    
    const timestamp = new Date().getTime() / 1000; // Convert to seconds
    setRobotGoal({
      variables: {
        robotId: robotId,
        xGoal: x,
        yGoal: y,
        thetaGoal: 0,
        timestamp: timestamp
      }
    }).catch(error => {
      console.error('Error setting robot goal:', error);
    });
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Robot Control Interface</h1>
      </header>
      <div className="control-container">
        <div className="sidebar">
          <RobotSelector 
            selectedRobotId={selectedRobotId} 
            onSelectRobot={setSelectedRobotId} 
          />
          <RobotControls 
            selectedRobotId={selectedRobotId}  
          />
          <RobotTypedGoals
            selectedRobotId={selectedRobotId} 
            // onSetGoal={setRobotGoal}
          />
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