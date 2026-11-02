/**
 * Map-frame (meters) → stage/world pixels. The occupancy image is mirrored on X.
 * @param {{ occGridWidth: number, occGridResolution: number, gridCellSize: number }} transform
 */
export function mapToPixel(transform, x, y) {
  const { occGridWidth, occGridResolution, gridCellSize } = transform;
  return {
    x: (occGridWidth - x / occGridResolution) * gridCellSize,
    y: (y * gridCellSize) / occGridResolution,
  };
}
