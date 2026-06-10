import React, { useEffect, useRef } from 'react';
import { useRobotColors } from '../hooks/useRobotColors';

const RobotSelector = ({
  selectedRobotId,
  onSelectRobot,
  robotPositions = [],
  positionsLoading,
  positionsError,
  multiPlanMode = false,
  multiFleet = {},
  onToggleFleet,
  onSetFleetAll,
  stagedMultiGoals = {},
}) => {
  const { getRobotColor, setRobotColor } = useRobotColors();
  const selectAllRef = useRef(null);
  const fleetCount = robotPositions.filter((robot) => multiFleet[robot.id]).length;
  const allFleetSelected =
    robotPositions.length > 0 && fleetCount === robotPositions.length;
  const someFleetSelected =
    fleetCount > 0 && fleetCount < robotPositions.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = multiPlanMode && someFleetSelected;
    }
  }, [multiPlanMode, someFleetSelected]);

  useEffect(() => {
    const robots = robotPositions;
    if (!onSelectRobot) return;

    if (robots.length === 0) {
      if (selectedRobotId != null) {
        onSelectRobot(null);
      }
      return;
    }

    const selectedStillExists = robots.some((r) => r.id === selectedRobotId);
    if (selectedRobotId != null && !selectedStillExists) {
      onSelectRobot(null);
      return;
    }

    const firstId = robots[0].id;
    if (robots.length === 1) {
      if (selectedRobotId !== firstId) {
        onSelectRobot(firstId);
      }
      return;
    }

    if (selectedRobotId == null) {
      onSelectRobot(firstId);
    }
  }, [selectedRobotId, robotPositions, onSelectRobot]);

  if (positionsLoading && robotPositions.length === 0) {
    return <div className="robot-selector">Loading robots...</div>;
  }
  if (positionsError) {
    return (
      <div className="robot-selector">Error loading robots: {positionsError.message}</div>
    );
  }

  const robots = robotPositions;

  const handleFleetToggle = (robotId, checked) => {
    onToggleFleet?.(robotId);
    if (checked) {
      onSelectRobot(robotId);
    }
  };

  return (
    <div className="robot-selector">
      <h3>{multiPlanMode ? 'Fleet & Select Robot' : 'Select Robot'}</h3>
      {multiPlanMode ? (
        <p className="robot-selector__hint">
          Check fleet members, click a robot, then stage its goal on the map.
        </p>
      ) : null}
      {robots.length === 0 ? (
        <p>No robots available</p>
      ) : (
        <>
          {multiPlanMode ? (
            <label className="robot-selector__select-all">
              <input
                ref={selectAllRef}
                type="checkbox"
                className="robot-selector__fleet-check"
                checked={allFleetSelected}
                onChange={(e) => onSetFleetAll?.(e.target.checked)}
                aria-label="Select or deselect all robots in fleet"
              />
              <span>All robots</span>
            </label>
          ) : null}
          <ul>
          {robots.map((robot) => {
            const label = robot.name || `Robot ${robot.id}`;
            const inFleet = !!multiFleet[robot.id];
            const goalStaged = !!stagedMultiGoals[robot.id];

            return (
              <li
                key={robot.id}
                className={[
                  robot.id === selectedRobotId ? 'selected' : '',
                  multiPlanMode && inFleet ? 'robot-selector__item--fleet' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelectRobot(robot.id)}
              >
                {multiPlanMode ? (
                  <input
                    type="checkbox"
                    className="robot-selector__fleet-check"
                    checked={inFleet}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleFleetToggle(robot.id, e.target.checked)}
                    aria-label={`Include ${label} in fleet`}
                    title="Include in multi-robot plan"
                  />
                ) : null}
                <span className="robot-selector__label">{label}</span>
                {multiPlanMode && goalStaged ? (
                  <span className="robot-selector__staged" title="Goal staged on map">
                    ✓
                  </span>
                ) : null}
                <input
                  type="color"
                  className="robot-selector__color-input"
                  value={getRobotColor(robot.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRobotColor(robot.id, e.target.value)}
                  aria-label={`Color for ${label}`}
                  title="Choose robot color"
                />
              </li>
            );
          })}
          </ul>
        </>
      )}
    </div>
  );
};

export default RobotSelector;
