import React from 'react';
import { useRobotColors } from '../hooks/useRobotColors';

/**
 * Controls for coordinated multi-robot goal plans (staged on map, sent via GraphQL).
 */
const MultiRobotGoalPlanner = ({
  robotPositions = [],
  multiFleet,
  onToggleFleet,
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
  const { getRobotColor } = useRobotColors();
  const fleetIds = Object.keys(multiFleet)
    .map(Number)
    .filter((id) => multiFleet[id]);
  const stagedIds = Object.keys(stagedMultiGoals).map(Number);
  const missing = fleetIds.filter((id) => !stagedMultiGoals[id]);
  const canSubmit =
    fleetIds.length >= 2 && missing.length === 0 && !submitting;

  return (
    <div className="multi-robot-planner">
      <p className="multi-robot-planner__hint">Check fleet, stage goals on map, send plan.</p>

      <div className="multi-robot-planner__fleet">
        {robotPositions.length === 0 ? (
          <span className="multi-robot-planner__muted">No robots online</span>
        ) : (
          <ul className="multi-robot-planner__checkboxes">
            {robotPositions.map((r) => (
              <li key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!multiFleet[r.id]}
                    onChange={() => onToggleFleet(r.id)}
                  />
                  <span
                    className="multi-robot-planner__dot"
                    style={{ backgroundColor: getRobotColor(r.id) }}
                  />
                  <span className="multi-robot-planner__robot-name">
                    R{r.id}
                    {stagedMultiGoals[r.id] ? ' ✓' : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

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
