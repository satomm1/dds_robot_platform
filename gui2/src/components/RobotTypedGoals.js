import React from 'react';

const RobotTypedGoals = ({ selectedRobot }) => {
  if (!selectedRobot) {
    return <div>No robot selected</div>;
  }

  return (
    <div className="manual-goal-input">
        {/* <h3>Set Goal for: {selectedRobot.name}</h3> */}
        <div className="goal-inputs">
            <label>
            X Position:
            <input 
                type="number" 
                placeholder="X coordinate" 
                style={{ width: '100px' }} // Set the input box size
            />
            </label>
            <br />
            <label>
            Y Position:
            <input 
                type="number" 
                placeholder="Y coordinate" 
                style={{ width: '100px' }} // Set the input box size
            />
            </label>
        </div>
        <button onClick={() => console.log('Set goal for robot')}>
            Set Goal
        </button>
    </div>
  );
};

export default RobotTypedGoals;