import React from 'react';
import { Layer, Rect, Image as KonvaImage } from 'react-konva';

/** Static occupancy grid background - only redraws when the map image changes. */
const MapImageLayer = ({ mapImage, width, height }) => (
  <Layer listening={false}>
    {mapImage ? (
      <KonvaImage image={mapImage} x={0} y={0} width={width} height={height} />
    ) : (
      <Rect width={width} height={height} fill="#E4F8FF" />
    )}
  </Layer>
);

export default React.memo(MapImageLayer);
