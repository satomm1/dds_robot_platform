import React, { useEffect } from 'react';
import { useRobotColors } from '../hooks/useRobotColors';

const RobotSelector = ({
  selectedRobotId,
  onSelectRobot,
  robotPositions = [],
  positionsLoading,
  positionsError,
  airQualities = [],
}) => {
  const { getRobotColor, setRobotColor } = useRobotColors();

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
  const selectedAirQuality =
    selectedRobotId != null
      ? airQualities.find((aq) => aq.robot_id === selectedRobotId)
      : null;

  return (
    <div className="robot-selector">
      <h3>Select Robot</h3>
      {robots.length === 0 ? (
        <p>No robots available</p>
      ) : (
        <ul>
          {robots.map((robot) => (
            <li
              key={robot.id}
              className={robot.id === selectedRobotId ? 'selected' : ''}
              onClick={() => onSelectRobot(robot.id)}
            >
              {robot.name || `Robot ${robot.id}`}
              <input
                type="color"
                className="robot-selector__color-input"
                value={getRobotColor(robot.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setRobotColor(robot.id, e.target.value)}
                aria-label={`Color for ${robot.name || `Robot ${robot.id}`}`}
                title="Choose robot color"
              />
            </li>
          ))}
        </ul>
      )}
      {selectedAirQuality && (
        <div className="robot-selector__air-quality" aria-label="Air quality for selected robot">
          <h4>Air quality</h4>
          <dl>
            <div>
              <dt>Temp</dt>
              <dd>{selectedAirQuality.temperature.toFixed(1)} °F</dd>
            </div>
            <div>
              <dt>Humidity</dt>
              <dd>{selectedAirQuality.relative_humidity.toFixed(1)} %</dd>
            </div>
            <div>
              <dt>VOC</dt>
              <dd>{selectedAirQuality.voc_index.toFixed(0)}</dd>
            </div>
            <div>
              <dt>NOx</dt>
              <dd>{selectedAirQuality.nox_index.toFixed(0)}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
};

export default RobotSelector;
