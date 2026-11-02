import React from 'react';
import { Layer, Circle, Arrow, Text } from 'react-konva';
import { mapToPixel } from './mapTransform';

function stagePointer(e) {
  const pointer = e.target.getStage()?.getPointerPosition();
  return pointer ? { x: pointer.x, y: pointer.y } : null;
}

/** Robot markers with heading arrows; hover callbacks drive the air quality tooltip. */
const RobotsLayer = ({
  robotPositions,
  transform,
  selectedRobotId,
  robotMarkerRadius,
  getRobotColor,
  isRobotVisibleOnMap,
  onRobotPointerEnter,
  onRobotPointerMove,
  onRobotPointerLeave,
}) => {
  const arrowLen = robotMarkerRadius * 1.25;
  const labelSize = Math.max(8, Math.round(robotMarkerRadius * 0.95));
  const labelOffset = robotMarkerRadius * 0.28;

  return (
    <Layer>
      {robotPositions.map((robot) => {
        if (!isRobotVisibleOnMap(robot.id)) {
          return null;
        }
        const { x: cx, y: cy } = mapToPixel(transform, robot.x, robot.y);
        const isSelected = robot.id === selectedRobotId;
        return (
          <React.Fragment key={robot.id}>
            <Circle
              x={cx}
              y={cy}
              radius={robotMarkerRadius}
              fill={getRobotColor(robot.id)}
              stroke="#000"
              strokeWidth={isSelected ? Math.max(2, robotMarkerRadius / 3) : 2}
              onMouseEnter={(e) => onRobotPointerEnter(robot.id, stagePointer(e))}
              onMouseLeave={onRobotPointerLeave}
              onMouseMove={(e) => onRobotPointerMove(robot.id, stagePointer(e))}
            />
            <Arrow
              points={[
                cx,
                cy,
                cx - Math.cos(robot.theta) * arrowLen,
                cy + Math.sin(robot.theta) * arrowLen,
              ]}
              stroke="#000"
              fill="#000"
              strokeWidth={2}
              pointerAtEnding
              pointerLength={10}
              pointerWidth={8}
            />
            <Text
              x={cx - labelOffset}
              y={cy - labelOffset}
              text={robot.id.toString()}
              fontSize={labelSize}
              fill="#fff"
            />
          </React.Fragment>
        );
      })}
    </Layer>
  );
};

export default React.memo(RobotsLayer);
