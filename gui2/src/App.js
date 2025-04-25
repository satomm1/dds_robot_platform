import React, { useState } from 'react';
import './App.css';
import { ApolloProvider, useQuery } from '@apollo/client';
import client from './apolloClient';
import RobotMap from './components/RobotMap';
import RobotSelector from './components/RobotSelector';
import RobotControls from './components/RobotControls';
import RobotTypedGoals from './components/RobotTypedGoals';

// Mock robot data (replace with actual data from your GraphQL API)
const mockRobots = [
  { id: 'robot1', name: 'Robot 1', x: 50, y: 50 },
  { id: 'robot2', name: 'Robot 2', x: 150, y: 100 },
  { id: 'robot3', name: 'Robot 3', x: 200, y: 200 },
];

function App() {
  const [robots, setRobots] = useState(mockRobots);
  const [selectedRobotId, setSelectedRobotId] = useState(mockRobots[0].id);
  
  // This function will be replaced with a GraphQL mutation
  const setRobotGoal = (robotId, x, y) => {
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
              robots={robots} 
              selectedRobotId={selectedRobotId} 
              onSelectRobot={setSelectedRobotId} 
            />
            <RobotControls 
              selectedRobot={robots.find(r => r.id === selectedRobotId)} 
            />
            <RobotTypedGoals
              selectedRobot={robots.find(r => r.id === selectedRobotId)} 
              // onSetGoal={setRobotGoal}
            />
          </div>
          <div className="map-container">
            <RobotMap 
              robots={robots} 
              selectedRobotId={selectedRobotId}
              onSetGoal={setRobotGoal}
            />
          </div>
        </div>
      </div>
    </ApolloProvider>
  );
}

export default App;