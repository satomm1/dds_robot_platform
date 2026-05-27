import React from 'react';
import DraggablePanel from './DraggablePanel';

const STORAGE_KEY = 'dds_gui_map_controls_position';

const MapControlsPanel = ({ containerRef, onDraggingChange, children }) => (
  <DraggablePanel
    containerRef={containerRef}
    storageKey={STORAGE_KEY}
    className="map-controls"
    handleLabel="Move"
    handleAriaLabel="Drag map controls"
    onDraggingChange={onDraggingChange}
  >
    {children}
  </DraggablePanel>
);

export default MapControlsPanel;
