import React from 'react';
import { Layer, Circle, Line, Arrow, Text } from 'react-konva';
import { mapToPixel } from './mapTransform';

const PATROL_COLOR = '#0d6e4f';

/** Goal markers, staged multi-robot goals, and staged patrol points. */
const GoalsLayer = ({
  goalMarkers,
  stagedMultiGoals,
  stagedPatrolPoints,
  robotPositions,
  transform,
  robotMarkerRadius,
  getRobotColor,
  isRobotVisibleOnMap,
  pathDisplayDismissed,
}) => {
  const arrowLen = robotMarkerRadius * 1.25;
  const labelSize = Math.max(8, Math.round(robotMarkerRadius * 0.95));
  const labelOffset = robotMarkerRadius * 0.28;

  return (
    <Layer listening={false}>
      {Object.entries(goalMarkers).map(([robotId, marker]) => {
        const rid = Number(robotId);
        if (!isRobotVisibleOnMap(rid) || pathDisplayDismissed[rid]) {
          return null;
        }
        const robot = robotPositions.find((r) => r.id === rid);
        if (!robot) return null;
        const robotPx = mapToPixel(transform, robot.x, robot.y);

        return (
          <React.Fragment key={`goal-${robotId}`}>
            <Circle
              x={marker.x}
              y={marker.y}
              radius={8}
              fill={getRobotColor(robotId)}
              opacity={0.6}
            />
            <Line
              points={[robotPx.x, robotPx.y, marker.x, marker.y]}
              stroke={getRobotColor(robotId)}
              strokeWidth={2}
              dash={[5, 5]}
            />
          </React.Fragment>
        );
      })}
      {Object.entries(stagedMultiGoals).map(([robotIdStr, pos]) => {
        const robotId = Number(robotIdStr);
        if (!isRobotVisibleOnMap(robotId)) {
          return null;
        }
        if (!pos || typeof pos.mapX !== 'number') return null;
        const robot = robotPositions.find((r) => r.id === robotId);
        const { x: px, y: py } = mapToPixel(transform, pos.mapX, pos.mapY);
        const color = getRobotColor(robotId);
        const robotPx = robot ? mapToPixel(transform, robot.x, robot.y) : null;
        return (
          <React.Fragment key={`staged-multi-${robotIdStr}`}>
            <Circle
              x={px}
              y={py}
              radius={10}
              stroke={color}
              strokeWidth={3}
              fill="rgba(255,255,255,0.15)"
              dash={[6, 4]}
            />
            {robotPx && (
              <Line
                points={[robotPx.x, robotPx.y, px, py]}
                stroke={color}
                strokeWidth={2}
                dash={[4, 6]}
                opacity={0.85}
              />
            )}
          </React.Fragment>
        );
      })}
      {stagedPatrolPoints.map((pt, index) => {
        if (!pt || typeof pt.mapX !== 'number') return null;
        const { x: px, y: py } = mapToPixel(transform, pt.mapX, pt.mapY);
        // Patrol loops back to the first point, so close the polygon on the last leg.
        const isClosingLeg = index === stagedPatrolPoints.length - 1;
        const prev = index > 0 ? stagedPatrolPoints[index - 1] : null;
        const prevPx =
          prev && typeof prev.mapX === 'number' && typeof prev.mapY === 'number'
            ? mapToPixel(transform, prev.mapX, prev.mapY)
            : null;
        const first = stagedPatrolPoints[0];
        const showClosingLeg =
          isClosingLeg &&
          stagedPatrolPoints.length > 2 &&
          first &&
          typeof first.mapX === 'number' &&
          typeof first.mapY === 'number';
        const firstPx = showClosingLeg ? mapToPixel(transform, first.mapX, first.mapY) : null;
        return (
          <React.Fragment key={`patrol-${pt.id}`}>
            {prevPx && (
              <Line
                points={[prevPx.x, prevPx.y, px, py]}
                stroke={PATROL_COLOR}
                strokeWidth={2}
                dash={[6, 4]}
                opacity={0.85}
              />
            )}
            {showClosingLeg && (
              <Line
                points={[px, py, firstPx.x, firstPx.y]}
                stroke={PATROL_COLOR}
                strokeWidth={2}
                dash={[6, 4]}
                opacity={0.85}
              />
            )}
            <Circle
              x={px}
              y={py}
              radius={robotMarkerRadius}
              stroke={PATROL_COLOR}
              strokeWidth={3}
              fill="rgba(13,110,79,0.35)"
            />
            <Arrow
              points={[
                px,
                py,
                px - Math.cos(pt.theta) * arrowLen,
                py + Math.sin(pt.theta) * arrowLen,
              ]}
              stroke={PATROL_COLOR}
              fill={PATROL_COLOR}
              strokeWidth={2}
              pointerAtEnding
              pointerLength={10}
              pointerWidth={8}
            />
            <Text
              x={px - labelOffset}
              y={py - labelOffset}
              text={String(index + 1)}
              fontSize={labelSize}
              fill="#fff"
              fontStyle="bold"
            />
          </React.Fragment>
        );
      })}
    </Layer>
  );
};

export default React.memo(GoalsLayer);
