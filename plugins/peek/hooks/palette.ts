import type { Pixels } from './bmp'

// Fits pixels to the xterm 256-color palette. The engine draws a Raster in
// these 256 colors even where the terminal reports 24-bit color, and keeps
// colors 16..255 as given; it would otherwise round each pixel itself, which
// measured worse than this (live: 16.2 against 14.3 mean delta-E).

export const TRANSPARENT = -1

const LEVELS = [0, 95, 135, 175, 215, 255]

const XTERM: readonly number[] = [
  ...LEVELS.flatMap(r => LEVELS.flatMap(g => LEVELS.map(b => (r << 16) | (g << 8) | b))),
  ...Array.from({ length: 24 }, (_, i) => 8 + 10 * i).map(v => (v << 16) | (v << 8) | v),
]

type Lab = [number, number, number]

const linear = (c: number) => {
  const u = c / 255
  return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4
}
const curve = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116)

const labOf = (r: number, g: number, b: number): Lab => {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)]
  const x = curve((0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047)
  const y = curve(0.2126 * lr + 0.7152 * lg + 0.0722 * lb)
  const z = curve((0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

const XTERM_LAB = XTERM.map(c => labOf(c >> 16, (c >> 8) & 0xff, c & 0xff))

// The palette color that looks closest (nearest in CIE Lab).
export const nearest = (r: number, g: number, b: number): number => {
  const [l, a, bb] = labOf(r, g, b)
  let best = 0
  let bestDistance = Infinity
  XTERM_LAB.forEach(([pl, pa, pb], i) => {
    const d = (l - pl) ** 2 + (a - pa) ** 2 + (bb - pb) ** 2
    if (d < bestDistance) [best, bestDistance] = [i, d]
  })
  return XTERM[best] ?? 0
}

// Each pixel as a palette color, with `strength` of each pixel's error carried
// to its neighbours (Floyd-Steinberg): 0 is plain nearest, 1 full dithering.
// Measured live in a 256-color terminal on two photos (mean CIE76 delta-E
// against the original), 0.25 cuts the error a viewer integrates by 8-22%
// over plain nearest, keeps sharp error level, and avoids the checkerboard and
// stray specks that stronger dithering leaves in this small palette.
export const quantize = ({ width, height, rgba }: Pixels, strength: number): Int32Array => {
  const work = Float32Array.from(rgba)
  const out = new Int32Array(width * height)
  const spread = (x: number, y: number, e: readonly number[], share: number) => {
    if (x < 0 || x >= width || y >= height) return
    const at = (y * width + x) * 4
    for (let k = 0; k < 3; k++) work[at + k] = (work[at + k] ?? 0) + (e[k] ?? 0) * share
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      if (rgba[at + 3] === 0) {
        out[y * width + x] = TRANSPARENT
        continue
      }
      const [r, g, b] = [0, 1, 2].map(k => Math.min(255, Math.max(0, work[at + k] ?? 0))) as [number, number, number]
      const color = nearest(r, g, b)
      out[y * width + x] = color
      const e = [r - (color >> 16), g - ((color >> 8) & 0xff), b - (color & 0xff)].map(v => v * strength)
      spread(x + 1, y, e, 7 / 16)
      spread(x - 1, y + 1, e, 3 / 16)
      spread(x, y + 1, e, 5 / 16)
      spread(x + 1, y + 1, e, 1 / 16)
    }
  }
  return out
}
