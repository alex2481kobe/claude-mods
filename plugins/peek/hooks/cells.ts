import type { Cells } from '../types'
import { TRANSPARENT } from './palette'

const UPPER_HALF = 0x2580 // '▀': foreground paints the top pixel, background the bottom
const LOWER_HALF = 0x2584 // '▄': for a transparent top pixel, foreground paints the bottom
const SPACE = 0x20
const DEFAULT = 0x01000000 // the terminal's own color

// Raster cells for `colors` (0xRRGGBB or TRANSPARENT, row-major), two pixel
// rows per cell row.
export const pictureOf = (colors: Int32Array, width: number, height: number): Cells => {
  const at = (x: number, y: number) => (y < height ? (colors[y * width + x] ?? TRANSPARENT) : TRANSPARENT)
  const rows = Math.ceil(height / 2)
  const words = new Uint32Array(width * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < width; x++) {
      const top = at(x, r * 2)
      const bottom = at(x, r * 2 + 1)
      const bg = bottom === TRANSPARENT ? DEFAULT : bottom
      // A default foreground is the text color, not the background: never
      // paint a transparent pixel with the foreground.
      const cell =
        top !== TRANSPARENT ? [UPPER_HALF, top, bg]
        : bottom !== TRANSPARENT ? [LOWER_HALF, bottom, DEFAULT]
        : [SPACE, DEFAULT, DEFAULT]
      words.set(cell, (r * width + x) * 3)
    }
  }
  return { kind: 'cells', columns: width, rows, cells: new Uint8Array(words.buffer).toBase64() }
}
