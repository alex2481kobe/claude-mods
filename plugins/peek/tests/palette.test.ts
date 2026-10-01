import { describe, expect, test } from 'claude-code/testing'

import type { Pixels } from '../hooks/bmp'
import { nearest, quantize, TRANSPARENT } from '../hooks/palette'

const flat = (width: number, height: number, [r, g, b]: number[], alpha = 255): Pixels => ({
  width,
  height,
  rgba: Uint8Array.from({ length: width * height * 4 }, (_, i) => [r, g, b, alpha][i % 4] ?? 0),
})
const channels = (c: number) => [c >> 16, (c >> 8) & 0xff, c & 0xff]

describe('palette', () => {
  test('a palette color is its own nearest', () => {
    for (const c of [0x5f87af, 0xd7ff00, 0x080808, 0xeeeeee, 0x000000, 0xffffff]) {
      expect(nearest(...(channels(c) as [number, number, number]))).toBe(c)
    }
  })

  test('without dithering every pixel is the nearest color', () => {
    const out = quantize(flat(4, 4, [120, 40, 200]), 0)
    expect(new Set(out).size).toBe(1)
    expect(out[0]).toBe(nearest(120, 40, 200))
  })

  test('dithering mixes palette colors whose average is closer to the true color', () => {
    const target = [120, 40, 200]
    const error = (out: Int32Array) => {
      const mean = [0, 1, 2].map(k => Array.from(out).reduce((s, c) => s + (channels(c)[k] ?? 0), 0) / out.length)
      return Math.hypot(...mean.map((m, k) => m - (target[k] ?? 0)))
    }
    const plain = quantize(flat(16, 16, target), 0)
    const dithered = quantize(flat(16, 16, target), 0.5)
    expect(new Set(dithered).size).toBeGreaterThan(1)
    expect(error(dithered)).toBeLessThan(error(plain))
  })

  test('transparent pixels stay transparent', () => {
    expect(Array.from(quantize(flat(2, 1, [9, 9, 9], 0), 0.5))).toEqual([TRANSPARENT, TRANSPARENT])
  })
})
