import React, { useEffect, useState } from 'react';
import DraggablePanel from './DraggablePanel';
import { defaultPanelTopLeft } from '../utils/draggablePanelPosition';

const STORAGE_KEY = 'dds_gui_air_quality_panel_position';

const AirQualityPanel = ({
  containerRef,
  selectedRobotId,
  robotPositions = [],
  airQualities = [],
  onDraggingChange,
}) => {
  const selectedAirQuality =
    selectedRobotId != null
      ? airQualities.find((aq) => Number(aq.robot_id) === Number(selectedRobotId))
      : null;

  const [, setReadingAgeTick] = useState(0);
  useEffect(() => {
    if (!selectedAirQuality) return undefined;
    const id = setInterval(() => setReadingAgeTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [selectedAirQuality, selectedRobotId]);

  if (!selectedAirQuality) {
    return null;
  }

  const robot = robotPositions.find((r) => Number(r.id) === Number(selectedRobotId));
  const robotLabel = robot?.name || `Robot ${selectedRobotId}`;
  const readingAgeSec = Math.max(
    0,
    Math.round(Date.now() / 1000 - Number(selectedAirQuality.timestamp)),
  );

  return (
    <DraggablePanel
      containerRef={containerRef}
      storageKey={STORAGE_KEY}
      className="air-quality-panel"
      handleLabel="Move"
      handleAriaLabel="Drag Air Quality panel"
      defaultPosition={defaultPanelTopLeft}
      onDraggingChange={onDraggingChange}
    >
      <div className="air-quality-panel__body" aria-label={`Air Quality for ${robotLabel}`}>
        <h4 className="air-quality-panel__title">{robotLabel} Air Quality</h4>
        <dl className="air-quality-panel__readings">
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
        <p className="air-quality-panel__meta">Reading {readingAgeSec}s ago</p>
      </div>
    </DraggablePanel>
  );
};

export default AirQualityPanel;
