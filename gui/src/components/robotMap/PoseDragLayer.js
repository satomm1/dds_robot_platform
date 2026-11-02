import React from 'react';
import { Layer, Circle, Arrow } from 'react-konva';

/** Live preview while click-dragging a pose; the only layer that updates during a drag. */
const PoseDragLayer = ({ poseDrag, color }) => (
  <Layer listening={false}>
    {poseDrag && (
      <>
        <Circle
          x={poseDrag.anchorWorld.x}
          y={poseDrag.anchorWorld.y}
          radius={8}
          fill={color}
          opacity={0.75}
        />
        <Arrow
          points={[
            poseDrag.anchorWorld.x,
            poseDrag.anchorWorld.y,
            poseDrag.pointerWorld.x,
            poseDrag.pointerWorld.y,
          ]}
          stroke={color}
          fill={color}
          strokeWidth={3}
          pointerAtEnding
          pointerLength={20}
          pointerWidth={15}
        />
      </>
    )}
  </Layer>
);

export default React.memo(PoseDragLayer);
