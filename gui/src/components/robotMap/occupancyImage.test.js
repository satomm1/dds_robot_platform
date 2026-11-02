import { fillOccupancyPixels } from './occupancyImage';

function rgba(pixel) {
  const [r, g, b, a] = new Uint8Array(new Uint32Array([pixel]).buffer);
  return [r, g, b, a];
}

const FREE = [0xe4, 0xf8, 0xff, 255];
const OCCUPIED = [0, 0, 0, 255];
const UNKNOWN = [0xa8, 0xa8, 0xa8, 255];

test('one pixel per cell, colored by value, mirrored on X', () => {
  // 3x2 grid, row-major: row 0 = [0, 100, -1], row 1 = [50, 0, 100]
  const occupancy = [0, 100, -1, 50, 0, 100];
  const pixels = new Uint32Array(6);
  fillOccupancyPixels(pixels, occupancy, 3, 2);

  // Cell (x, y) lands at pixel (width - x - 1, y).
  expect([0, 1, 2].map((i) => rgba(pixels[i]))).toEqual([UNKNOWN, OCCUPIED, FREE]);
  expect([3, 4, 5].map((i) => rgba(pixels[i]))).toEqual([OCCUPIED, FREE, UNKNOWN]);
});

test('accepts typed arrays as occupancy input', () => {
  const pixels = new Uint32Array(2);
  fillOccupancyPixels(pixels, Int8Array.from([100, 0]), 2, 1);
  expect(rgba(pixels[0])).toEqual(FREE);
  expect(rgba(pixels[1])).toEqual(OCCUPIED);
});
