// src/components/RobotTypedGoals.js
import React, { useState } from 'react';
import RotatingWheel from './RotatingWheel';

const RobotTypedGoals = ({ selectedRobotId, onSetGoal }) => {
  const [thetaGoal, setThetaGoal] = useState(0);
  
  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!selectedRobotId) {
      alert('Please select a robot first');
      return;
    }
    
    // Call the parent component's onSetGoal function, passing only the theta value
    // The x and y coordinates will be handled elsewhere
    onSetGoal(selectedRobotId, thetaGoal);
  };

  return (
    <div className="robot-typed-goals">
      <h3>Set Robot Orientation</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Orientation (θ):</label>
          <RotatingWheel 
            size={150} 
            value={thetaGoal} 
            onChange={setThetaGoal} 
          />
          <input
            type="range"
            min="0"
            max="359"
            value={thetaGoal}
            onChange={(e) => setThetaGoal(parseInt(e.target.value))}
            style={{ width: '100%', marginTop: '10px' }}
          />
          <div className="angle-display">
            <span>Current angle: {thetaGoal}°</span>
          </div>
        </div>
        <button 
          type="submit" 
          disabled={!selectedRobotId}
          className="btn-set-orientation"
        >
          Set Orientation
        </button>
      </form>
    </div>
  );
};

export default RobotTypedGoals;