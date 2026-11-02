import React, { useSyncExternalStore } from 'react';

/** Cursor coordinate readout and the click confirmation toast; both follow the pointer. */
const CursorOverlay = ({
  pointerStore,
  showCursorCoordinates,
  confirmationMessage,
  confirmationIsWarning,
}) => {
  const mousePosition = useSyncExternalStore(pointerStore.subscribe, pointerStore.get);

  return (
    <>
      {/* Tooltip layer outside the main stage - not affected by transforms */}
      {showCursorCoordinates && mousePosition && (
        <div
          className="robot-map__cursor-coords"
          style={{
            left: `${mousePosition.x + 14}px`,
            top: `${mousePosition.y}px`,
          }}
        >
          ({mousePosition.worldX.toFixed(2)}, {mousePosition.worldY.toFixed(2)})
        </div>
      )}

      {/* Confirmation / MCU warning message */}
      {confirmationMessage && (
        <div
          style={{
            position: 'absolute',
            left: `${mousePosition?.x || 0}px`,
            top: `${(mousePosition?.y || 0) - 30}px`,
            backgroundColor: confirmationIsWarning ? '#F44336' : '#2196F3',
            color: 'white',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 'bold',
            pointerEvents: 'none',
            zIndex: 1000,
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            animation: 'fadeIn 0.3s',
            maxWidth: confirmationIsWarning ? '360px' : undefined,
            whiteSpace: confirmationIsWarning ? 'normal' : 'nowrap',
          }}
        >
          {confirmationMessage}
        </div>
      )}
    </>
  );
};

export default React.memo(CursorOverlay);
