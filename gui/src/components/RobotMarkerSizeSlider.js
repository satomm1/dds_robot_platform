import React from 'react';

export const ROBOT_MARKER_RADIUS_KEY = 'dds_gui_robot_marker_radius';
export const ROBOT_MARKER_RADIUS_DEFAULT = 12;
export const ROBOT_MARKER_RADIUS_MIN = 4;
export const ROBOT_MARKER_RADIUS_MAX = 28;

export function readStoredRobotMarkerRadius() {
  try {
    const raw = localStorage.getItem(ROBOT_MARKER_RADIUS_KEY);
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return Math.min(
        ROBOT_MARKER_RADIUS_MAX,
        Math.max(ROBOT_MARKER_RADIUS_MIN, Math.round(n)),
      );
    }
  } catch {
    /* ignore */
  }
  return ROBOT_MARKER_RADIUS_DEFAULT;
}

const RobotMarkerSizeSlider = ({ value, onChange }) => (
  <div className="robot-marker-size">
    <label className="robot-marker-size__label" htmlFor="robot-marker-size-range">
      Robot size on map
    </label>
    <input
      id="robot-marker-size-range"
      className="robot-marker-size__range"
      type="range"
      min={ROBOT_MARKER_RADIUS_MIN}
      max={ROBOT_MARKER_RADIUS_MAX}
      step={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-valuemin={ROBOT_MARKER_RADIUS_MIN}
      aria-valuemax={ROBOT_MARKER_RADIUS_MAX}
      aria-valuenow={value}
    />
    <span className="robot-marker-size__value" aria-hidden="true">
      {value}
    </span>
  </div>
);

export default RobotMarkerSizeSlider;
