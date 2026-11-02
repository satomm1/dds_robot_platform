const FREE_COLOR = [0xe4, 0xf8, 0xff]; // #E4F8FF (value 0)
const OCCUPIED_COLOR = [0x00, 0x00, 0x00]; // #000000 (value 100)
const UNKNOWN_COLOR = [0xa8, 0xa8, 0xa8]; // #A8A8A8 (any other value)

/** Pack an RGB triple as one opaque RGBA pixel in platform byte order. */
function packRgba([r, g, b]) {
  const bytes = new Uint8ClampedArray([r, g, b, 255]);
  return new Uint32Array(bytes.buffer)[0];
}

const FREE_PIXEL = packRgba(FREE_COLOR);
const OCCUPIED_PIXEL = packRgba(OCCUPIED_COLOR);
const UNKNOWN_PIXEL = packRgba(UNKNOWN_COLOR);

/**
 * Write one pixel per occupancy cell into `pixels` (a Uint32 view of RGBA data).
 * X is mirrored so cell (x, y) lands at pixel (width - x - 1, y), matching the map frame.
 */
export function fillOccupancyPixels(pixels, occupancy, width, height) {
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const value = occupancy[row + x];
      pixels[row + (width - x - 1)] =
        value === 0 ? FREE_PIXEL : value === 100 ? OCCUPIED_PIXEL : UNKNOWN_PIXEL;
    }
  }
}

/** Canvas with one pixel per occupancy cell; scale it up with image smoothing disabled. */
export function createOccupancyCanvas(occupancy, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  fillOccupancyPixels(new Uint32Array(imageData.data.buffer), occupancy, width, height);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
