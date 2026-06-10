import React from 'react';

/**
 * Docked controls for coordinated multi-robot goal plans (fleet pickers live in RobotSelector).
 */
const MultiRobotGoalPlanner = ({
  multiFleet,
  planId,
  onPlanIdChange,
  coordinated,
  onCoordinatedChange,
  stagedMultiGoals,
  onClearStaged,
  onSubmit,
  submitting,
  submitError,
}) => {
  const fleetIds = Object.keys(multiFleet)
    .map(Number)
    .filter((id) => multiFleet[id]);
  const stagedIds = Object.keys(stagedMultiGoals).map(Number);
  const missing = fleetIds.filter((id) => !stagedMultiGoals[id]);
  const canSubmit =
    fleetIds.length >= 2 && missing.length === 0 && !submitting;

  return (
    <div className="multi-robot-planner">
      <div className="multi-robot-planner__meta">
        <label className="multi-robot-planner__plan-id">
          <span>Plan</span>
          <input
            type="text"
            value={planId}
            onChange={(e) => onPlanIdChange(e.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="multi-robot-planner__coord">
          <input
            type="checkbox"
            checked={coordinated}
            onChange={(e) => onCoordinatedChange(e.target.checked)}
          />
          Coordinated
        </label>
      </div>

      <div className="multi-robot-planner__actions">
        <button
          type="button"
          className="multi-robot-planner__btn"
          onClick={onClearStaged}
          disabled={stagedIds.length === 0}
        >
          Clear
        </button>
        <button
          type="button"
          className="multi-robot-planner__btn multi-robot-planner__btn--primary"
          onClick={onSubmit}
          disabled={!canSubmit}
        >
          {submitting ? '…' : 'Send plan'}
        </button>
      </div>

      {fleetIds.length > 0 && missing.length > 0 && (
        <p className="multi-robot-planner__warn">Stage goals for: {missing.join(', ')}</p>
      )}
      {fleetIds.length < 2 && fleetIds.length > 0 && (
        <p className="multi-robot-planner__warn">Pick at least two robots.</p>
      )}
      {submitError && <p className="multi-robot-planner__error">{submitError}</p>}
    </div>
  );
};

export default MultiRobotGoalPlanner;
