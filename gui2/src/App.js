import React, { useState } from 'react';
import './App.css';
import { ApolloProvider, useQuery } from '@apollo/client';
import client from './apolloClient';
import RobotMap from './components/RobotMap';
import RobotSelector from './components/RobotSelector';
import RobotControls from './components/RobotControls';
import RobotTypedGoals from './components/RobotTypedGoals';

function App() {
  // const [robots, setRobots] = useState(mockRobots);
  const [selectedRobotId, setSelectedRobotId] = useState('');
  
  // This function will be replaced with a GraphQL mutation
  const handleSetRobotGoal = (robotId, x, y) => {
    console.log(`Setting goal for robot ${robotId} to position (${x}, ${y})`);
    // In a real application, you would send this to your GraphQL API
  };

  return (
    <ApolloProvider client={client}>
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
              onSetGoal={handleSetRobotGoal }
            />
          </div>
        </div>
      </div>
    </ApolloProvider>
  );
}

export default App;