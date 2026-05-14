import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import { ApolloProvider, useMutation, useQuery } from '@apollo/client';
import client from './apolloClient';
import RobotMap from './components/RobotMap';
import RobotSelector from './components/RobotSelector';
import RobotControls from './components/RobotControls';
import RobotTypedGoals from './components/RobotTypedGoals';
import MultiRobotGoalPlanner from './components/MultiRobotGoalPlanner';
import { SET_ROBOT_GOAL, SET_ROBOT_INITIAL_POSITION, SET_MULTI_ROBOT_GOAL_PLAN } from './mutations';
import { GET_ROBOT_POSITIONS } from './queries';

const ROBOT_POSITIONS_POLL_MS = 2000;

const devLog = (...args) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(...args);
  }
};

function App() {
  return (
    <ApolloProvider client={client}>
      <AppContent />
    </ApolloProvider>
  );
}

// Create a new component that's wrapped by ApolloProvider
function AppContent() {
  const [selectedRobotId, setSelectedRobotId] = useState(null);

  const { data: positionsData, loading: positionsLoading, error: positionsError } = useQuery(
    GET_ROBOT_POSITIONS,
    {
      pollInterval: ROBOT_POSITIONS_POLL_MS,
      fetchPolicy: 'cache-and-network',
    }
  );
  const robotPositions = positionsData?.robotPositions ?? [];

  // State for theta, if needed
  const [currentTheta, setCurrentTheta] = useState(0);
  
  // Now this hook is inside the ApolloProvider context
  const [setRobotGoal] = useMutation(SET_ROBOT_GOAL);

  // State to manage position mode (goal, initial, or coordinated multi-robot plan)
  const [positionMode, setPositionMode] = useState('goal'); // 'goal' | 'initial' | 'multiPlan'
  const prevRobotCountRef = useRef(null);

  const [multiFleet, setMultiFleet] = useState({});
  const [stagedMultiGoals, setStagedMultiGoals] = useState({});
  const [multiPlanId, setMultiPlanId] = useState(() => `gui_${Date.now()}`);
  const [multiCoordinated, setMultiCoordinated] = useState(true);
  const [multiSubmitError, setMultiSubmitError] = useState('');

  const [setMultiRobotGoalPlan, { loading: multiSubmitting }] = useMutation(SET_MULTI_ROBOT_GOAL_PLAN);

  useEffect(() => {
    if (positionsError) return;
    const n = robotPositions.length;
    const prev = prevRobotCountRef.current;
    if (prev === 0 && n > 0) {
      setPositionMode('initial');
    }
    prevRobotCountRef.current = n;
  }, [robotPositions, positionsError]);

  // Mutation for setting the robot's initial position
  const [setRobotInitialPosition] = useMutation(SET_ROBOT_INITIAL_POSITION);
  
  const handleSetRobotGoal = (robotId, x, y) => {
    devLog(`Setting goal for robot ${robotId} to position (${x}, ${y}, ${currentTheta}°)`);
    
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

  const handleStageMultiGoal = (robotId, mapX, mapY) => {
    const theta_rad = (currentTheta * Math.PI) / 180;
    setStagedMultiGoals((prev) => ({
      ...prev,
      [robotId]: { mapX, mapY, theta: theta_rad },
    }));
    setMultiSubmitError('');
  };

  const toggleMultiFleet = (robotId) => {
    setMultiFleet((prev) => ({
      ...prev,
      [robotId]: !prev[robotId],
    }));
    setMultiSubmitError('');
  };

  const clearStagedMultiGoals = () => {
    setStagedMultiGoals({});
    setMultiSubmitError('');
  };

  const handleSubmitMultiRobotPlan = () => {
    const fleetIds = Object.keys(multiFleet)
      .map(Number)
      .filter((id) => multiFleet[id])
      .sort((a, b) => a - b);
    const missing = fleetIds.filter((id) => !stagedMultiGoals[id]);
    if (fleetIds.length < 2) {
      setMultiSubmitError('Select at least two robots in the fleet.');
      return;
    }
    if (missing.length > 0) {
      setMultiSubmitError(`Stage a map goal for robot(s): ${missing.join(', ')}`);
      return;
    }
    const planTimestamp = new Date().getTime() / 1000;
    const goals = fleetIds.map((robotId) => ({
      robot_id: robotId,
      x_goal: stagedMultiGoals[robotId].mapX,
      y_goal: stagedMultiGoals[robotId].mapY,
      theta_goal: stagedMultiGoals[robotId].theta,
    }));
    setMultiSubmitError('');
    setMultiRobotGoalPlan({
      variables: {
        planId: multiPlanId || `gui_${Date.now()}`,
        coordinated: multiCoordinated,
        planTimestamp,
        goals,
      },
    })
      .then(() => {
        setStagedMultiGoals({});
        setMultiFleet({});
        setMultiPlanId(`gui_${Date.now()}`);
      })
      .catch((err) => {
        console.error('setMultiRobotGoalPlan:', err);
        setMultiSubmitError(err.message || 'Failed to send multi-robot plan');
      });
  };

  const handleUpdateTheta = (robotId, thetaDegrees) => {
    devLog(`Updating orientation for robot ${robotId} to ${thetaDegrees}°`);
    
    // Flip the angle about the y-axis
    const flippedTheta = (180 - thetaDegrees) % 360;

    // Update the current theta value
    setCurrentTheta(flippedTheta);
  };

  const handleSetRobotInitialPosition = (robotId, x, y) => {
    devLog(`Setting initial position for robot ${robotId} to (${x}, ${y}, ${currentTheta}°)`);
    
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
              robotPositions={robotPositions}
              positionsLoading={positionsLoading}
              positionsError={positionsError}
            />
          </div>
          <div className="mode-toggle">
            <button 
              className={positionMode === 'goal' ? 'btn-goal-init-active btn-goal-narrow' : 'btn-goal-init-inactive btn-goal-narrow'}
              onClick={() => {
                setPositionMode('goal');
                setMultiSubmitError('');
              }}
            >
              Set Robot Goal
            </button>
            <button 
              className={positionMode === 'initial' ? 'btn-goal-init-active btn-goal-narrow' : 'btn-goal-init-inactive btn-goal-narrow'}
              onClick={() => {
                setPositionMode('initial');
                setMultiSubmitError('');
              }}
            >
              Set Initial Position
            </button>
            <button 
              className={positionMode === 'multiPlan' ? 'btn-goal-init-active btn-goal-narrow' : 'btn-goal-init-inactive btn-goal-narrow'}
              onClick={() => {
                setPositionMode('multiPlan');
                setMultiSubmitError('');
              }}
            >
              Multi-robot plan
            </button>
          </div>
          {positionMode === 'multiPlan' && (
            <MultiRobotGoalPlanner
              robotPositions={robotPositions}
              multiFleet={multiFleet}
              onToggleFleet={toggleMultiFleet}
              planId={multiPlanId}
              onPlanIdChange={setMultiPlanId}
              coordinated={multiCoordinated}
              onCoordinatedChange={setMultiCoordinated}
              stagedMultiGoals={stagedMultiGoals}
              onClearStaged={clearStagedMultiGoals}
              onSubmit={handleSubmitMultiRobotPlan}
              submitting={multiSubmitting}
              submitError={multiSubmitError}
            />
          )}
          <div style={{ overflowY: 'auto', maxHeight: '70%' }}>
            <RobotControls 
              selectedRobotId={selectedRobotId}
              robotPositions={robotPositions}
              positionsLoading={positionsLoading}
              positionsError={positionsError}
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
            robotPositions={robotPositions}
            positionsLoading={positionsLoading}
            positionsError={positionsError}
            onSetGoal={handleSetRobotGoal}
            onSetInitialPosition={handleSetRobotInitialPosition}
            positionMode={positionMode}
            multiPlanFleetIds={Object.keys(multiFleet)
              .map(Number)
              .filter((id) => multiFleet[id])}
            stagedMultiGoals={stagedMultiGoals}
            onStageMultiGoal={handleStageMultiGoal}
          />
        </div>
      </div>
    </div>
  );
}

export default App;