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
      <p className="multi-robot-planner__hint">
        Check all robots to include in plan, set goals in the map, and submit the plan.
      </p>
      <div className="multi-robot-planner__fleet">
        <span className="multi-robot-planner__label">Fleet</span>
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
                  Robot {r.id}
                  {stagedMultiGoals[r.id] ? ' (staged)' : ''}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <label className="multi-robot-planner__field">
        Plan ID
        <input
          type="text"
          value={planId}
          onChange={(e) => onPlanIdChange(e.target.value)}
          spellCheck={false}
        />
      </label>
      <label className="multi-robot-planner__field multi-robot-planner__field--row">
        <input
          type="checkbox"
          checked={coordinated}
          onChange={(e) => onCoordinatedChange(e.target.checked)}
        />
        Coordinated (multi-robot timing)
      </label>
      <div className="multi-robot-planner__actions">
        <button type="button" onClick={onClearStaged} disabled={stagedIds.length === 0}>
          Clear staged goals
        </button>
        <button type="button" onClick={onSubmit} disabled={!canSubmit}>
          {submitting ? 'Sending…' : 'Send multi-robot plan'}
        </button>
      </div>
      {fleetIds.length > 0 && missing.length > 0 && (
        <p className="multi-robot-planner__warn">
          Stage a map goal for: {missing.join(', ')}
        </p>
      )}
      {fleetIds.length < 2 && fleetIds.length > 0 && (
        <p className="multi-robot-planner__warn">Select at least two robots for a fleet plan.</p>
      )}
      {submitError && (
        <p className="multi-robot-planner__error">{submitError}</p>
      )}
    </div>
  );
};

export default MultiRobotGoalPlanner;
