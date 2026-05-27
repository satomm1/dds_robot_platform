import React, { useEffect } from 'react';
import RobotMarkerSizeSlider from './RobotMarkerSizeSlider';
import {
  MAP_PATH_WIDTH_MAX,
  MAP_PATH_WIDTH_MIN,
} from '../utils/mapDisplaySettings';

const MapSettingsModal = ({
  onClose,
  robotMarkerRadius,
  onRobotMarkerRadiusChange,
  showPaths,
  onShowPathsChange,
  pathWidth,
  onPathWidthChange,
  showCursorCoords,
  onShowCursorCoordsChange,
  showSelectedRobotOnly,
  onShowSelectedRobotOnlyChange,
  showAirQualityOnHover,
  onShowAirQualityOnHoverChange,
  showMapControls,
  onShowMapControlsChange,
}) => {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="help-overlay" onClick={onClose} role="presentation">
      <div
        className="map-settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-settings-modal-title"
      >
        <button
          type="button"
          className="help-modal__close"
          onClick={onClose}
          aria-label="Close map settings"
        >
          ×
        </button>
        <h2 id="map-settings-modal-title" className="help-modal__title">
          Map Settings
        </h2>

        <section className="map-settings-modal__section" aria-label="Robots">
          <RobotMarkerSizeSlider
            value={robotMarkerRadius}
            onChange={onRobotMarkerRadiusChange}
          />
          <label className="map-settings-modal__check">
            <input
              type="checkbox"
              checked={showSelectedRobotOnly}
              onChange={(e) => onShowSelectedRobotOnlyChange(e.target.checked)}
            />
            Show selected robot only
          </label>
          <label className="map-settings-modal__check">
            <input
              type="checkbox"
              checked={showAirQualityOnHover}
              onChange={(e) => onShowAirQualityOnHoverChange(e.target.checked)}
            />
            Show air quality
          </label>
        </section>

        <section className="map-settings-modal__section" aria-label="Paths">
          <label className="map-settings-modal__check">
            <input
              type="checkbox"
              checked={showPaths}
              onChange={(e) => onShowPathsChange(e.target.checked)}
            />
            Show paths
          </label>
          <label className="map-settings-modal__range-row">
            <span className="map-settings-modal__range-label">Path width</span>
            <input
              className="map-settings-modal__range"
              type="range"
              min={MAP_PATH_WIDTH_MIN}
              max={MAP_PATH_WIDTH_MAX}
              step={1}
              value={pathWidth}
              onChange={(e) => onPathWidthChange(Number(e.target.value))}
              disabled={!showPaths}
              aria-valuemin={MAP_PATH_WIDTH_MIN}
              aria-valuemax={MAP_PATH_WIDTH_MAX}
              aria-valuenow={pathWidth}
            />
            <span className="map-settings-modal__range-value" aria-hidden="true">
              {pathWidth}
            </span>
          </label>
        </section>

        <section className="map-settings-modal__section" aria-label="Map display">
          <label className="map-settings-modal__check">
            <input
              type="checkbox"
              checked={showMapControls}
              onChange={(e) => onShowMapControlsChange(e.target.checked)}
            />
            Show map controls
          </label>
          <label className="map-settings-modal__check">
            <input
              type="checkbox"
              checked={showCursorCoords}
              onChange={(e) => onShowCursorCoordsChange(e.target.checked)}
            />
            Show cursor coordinates
          </label>
        </section>
      </div>
    </div>
  );
};

export default MapSettingsModal;
