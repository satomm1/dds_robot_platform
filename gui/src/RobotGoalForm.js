import React, { useState } from 'react';
import { useMutation } from '@apollo/client';
import { SET_ROBOT_GOAL } from './mutations';

const RobotGoalForm = () => {
  const [robotId, setRobotId] = useState('');
  const [xGoal, setXGoal] = useState('');
  const [yGoal, setYGoal] = useState('');
  const [thetaGoal, setThetaGoal] = useState('');

  const [setRobotGoal, { loading, error }] = useMutation(SET_ROBOT_GOAL);

  const handleSubmit = (e) => {
    e.preventDefault();
    const timestamp = new Date().getTime() / 1000;
    setRobotGoal({ variables: { robotId: parseInt(robotId), xGoal: parseFloat(xGoal), yGoal: parseFloat(yGoal), thetaGoal: parseFloat(thetaGoal), timestamp: timestamp } });
  };

  return (
    <div id='goal-form'>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Robot ID: </label>
          <input
            type="number"
            value={robotId}
            onChange={(e) => setRobotId(e.target.value)}
            required
          />
        </div>
        <div>
          <label>X Goal: </label>
          <input
            type="number"
            value={xGoal}
            onChange={(e) => setXGoal(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Y Goal: </label>
          <input
            type="number"
            value={yGoal}
            onChange={(e) => setYGoal(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Theta Goal: </label>
          <input
            type="number"
            value={thetaGoal}
            onChange={(e) => setThetaGoal(e.target.value)}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Submitting...' : 'Submit'}
        </button>
        {error && <p>Error: {error.message}</p>}
      </form>
    </div>
  );
};

export default RobotGoalForm;
