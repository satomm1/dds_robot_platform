import React from 'react';
import { Layer, Circle, Label, Tag, Text } from 'react-konva';
import { mapToPixel } from './mapTransform';

function stringToHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

/** Appearance by object type; unknown types get a consistent hue derived from the name. */
function getObjectAppearance(type) {
  switch (type) {
    case 'person':
      return { color: 'yellow', radius: 12 };
    case 'cone':
      return { color: 'orange', radius: 10 };
    default: {
      const hue = Math.abs(stringToHash(type)) % 360;
      return { color: `hsl(${hue}, 70%, 50%)`, radius: 10 };
    }
  }
}

/** Detected objects (people, cones, ...) with a type label. */
const ObjectsLayer = ({ detectedObjects, transform }) => (
  <Layer listening={false}>
    {detectedObjects.map((object) => {
      const { x, y } = mapToPixel(transform, object.x, object.y);
      const { color, radius } = getObjectAppearance(object.type);

      return (
        <React.Fragment key={`object-${object.id}`}>
          <Circle
            x={x}
            y={y}
            radius={radius}
            fill={color}
            opacity={0.75}
            stroke="black"
            strokeWidth={1}
          />
          <Label x={x + radius + 2} y={y - 10}>
            <Tag fill="rgba(255, 255, 255, 0.8)" cornerRadius={3} padding={3} />
            <Text text={`${object.type}`} fontSize={12} fill="black" padding={2} />
          </Label>
        </React.Fragment>
      );
    })}
  </Layer>
);

export default React.memo(ObjectsLayer);
