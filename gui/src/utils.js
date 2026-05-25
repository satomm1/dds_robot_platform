function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - chroma / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    r = chroma;
    g = x;
  } else if (h < 120) {
    r = x;
    g = chroma;
  } else if (h < 180) {
    g = chroma;
    b = x;
  } else if (h < 240) {
    g = x;
    b = chroma;
  } else if (h < 300) {
    r = x;
    b = chroma;
  } else {
    r = chroma;
    b = x;
  }

  const toHex = (channel) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Default map color for a robot ID (before any user override). */
export const getDefaultRobotColor = (robotId) => {
  const id = Number(robotId);
  if (id === 1) return '#00ec15';
  if (id === 2) return '#e700cf';
  if (id === 3) return '#007bff';
  if (id === 4) return '#ff7f50';
  if (id === 5) return '#00ec15';
  if (id === 6) return '#ff13f0';
  const hash = id * 137 % 360;
  return hslToHex(hash, 70, 50);
};

/** @deprecated Use useRobotColors().getRobotColor for persisted user colors. */
export const getRobotColor = (robotId) => getDefaultRobotColor(robotId);

/**
 * Map UI angle (degrees, 0–360) to robot-frame heading used by the backend.
 * Y-axis flip between map UI drag angle and robot-frame heading.
 */
export function uiDegreesToRobotThetaDegrees(uiDegrees) {
  return (180 - uiDegrees) % 360;
}

/** Heading in radians for GraphQL from a map drag in stage/world pixels. */
export function mapDragToRobotThetaRad(anchorWorld, pointerWorld) {
  const dx = pointerWorld.x - anchorWorld.x;
  const dy = pointerWorld.y - anchorWorld.y;
  let uiDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (uiDeg < 0) {
    uiDeg += 360;
  }
  const robotDeg = uiDegreesToRobotThetaDegrees(uiDeg);
  return (robotDeg * Math.PI) / 180;
}
