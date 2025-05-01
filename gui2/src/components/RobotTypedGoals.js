import React, { useState, useEffect } from 'react';
import RotatingWheel from './RotatingWheel';

const RobotTypedGoals = ({ selectedRobotId, onSetGoal }) => {
  const [thetaGoal, setThetaGoal] = useState(0);
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!selectedRobotId) {
      alert('Please select a robot first');
      return;
    }

    onSetGoal(selectedRobotId, thetaGoal);

    // Show confirmation message
    setConfirmationMessage('Orientation set successfully!');
    setTimeout(() => setConfirmationMessage(''), 1500); // Clear message after 3 seconds
  };

  return (
    <div className="robot-typed-goals">
      <h3>Set Robot Orientation</h3>
      {confirmationMessage && (
        <div 
          className="confirmation-bubble"
          style={{
            position: 'fixed',
            left: `${mousePosition.x}px`,
            top: `${mousePosition.y - 30}px`, // Position slightly above cursor
            backgroundColor: '#4CAF50',
            color: 'white',
            padding: '4px 6px',
            borderRadius: '4px',
            zIndex: 1000,
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            pointerEvents: 'none', // Makes it non-interactive
            animation: 'fadeIn 0.3s',
            fontSize: '14px'
          }}
        >
          {confirmationMessage}
        </div>
      )}
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
    </div>
  );
};

export default RobotTypedGoals;