import React, { useState } from 'react';
import RotatingWheel from './RotatingWheel';

const RobotTypedGoals = ({ selectedRobotId, onSetGoal }) => {
  const [thetaGoal, setThetaGoal] = useState(0);
  const [confirmationMessage, setConfirmationMessage] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!selectedRobotId) {
      alert('Please select a robot first');
      return;
    }

    onSetGoal(selectedRobotId, thetaGoal);

    // Show confirmation message
    setConfirmationMessage('Orientation set successfully!');
    setTimeout(() => setConfirmationMessage(''), 3000); // Clear message after 3 seconds
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
        </div>
        <button 
          type="submit" 
          disabled={!selectedRobotId}
          className="btn-set-orientation"
        >
          Set Orientation
        </button>
      </form>
      {confirmationMessage && (
        <p className="confirmation-message">{confirmationMessage}</p>
      )}
    </div>
  );
};

export default RobotTypedGoals;