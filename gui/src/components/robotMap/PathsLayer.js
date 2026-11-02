import React from 'react';
import { Layer, Line } from 'react-konva';

/** Planned robot paths. `robotPaths` maps robot id → flat [x0, y0, x1, y1, ...] pixel points. */
const PathsLayer = ({
  robotPaths,
  visible,
  strokeWidth,
  getRobotColor,
  isRobotVisibleOnMap,
  pathDisplayDismissed,
}) => (
  <Layer visible={visible} listening={false}>
    {Object.entries(robotPaths).map(([robotId, points]) => {
      const rid = Number(robotId);
      if (!isRobotVisibleOnMap(rid) || pathDisplayDismissed[rid]) {
        return null;
      }
      return (
        <Line
          key={`path-${robotId}`}
          points={points}
          stroke={getRobotColor(robotId)}
          strokeWidth={strokeWidth}
          opacity={0.7}
        />
      );
    })}
  </Layer>
);

export default React.memo(PathsLayer);
