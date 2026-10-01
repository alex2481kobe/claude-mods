import { describe, expect, test } from 'claude-code/testing'

import { decodeBmp } from '../hooks/bmp'

// A width x height BMP of 32-bit BGRA pixels, given top row first as 0xAARRGGBB.
const bmp = (width: number, pixels: number[], isBottomUp: boolean): Uint8Array => {
  const height = pixels.length / width
  const bytes = new Uint8Array(54 + pixels.length * 4)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0x4d42, true)
  view.setUint32(10, 54, true)
  view.setInt32(18, width, true)
  view.setInt32(22, isBottomUp ? height : -height, true)
  view.setUint16(28, 32, true)
  pixels.forEach((argb, i) => {
    const y = Math.floor(i / width)
    const at = 54 + ((isBottomUp ? height - 1 - y : y) * width + (i % width)) * 4
    bytes.set([argb & 0xff, (argb >> 8) & 0xff, (argb >> 16) & 0xff, (argb >>> 24) & 0xff], at)
  })
  return bytes
}

describe('bmp', () => {
  test('reads both row orders top row first, alpha 0 as transparent', () => {
    for (const isBottomUp of [true, false]) {
      const { width, height, rgba } = decodeBmp(bmp(2, [0xffff0000, 0x00000000, 0xff0000ff, 0xff00ff00], isBottomUp))
      expect([width, height]).toEqual([2, 2])
      expect(Array.from(rgba)).toEqual([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 255, 0, 255])
    }
  })

  test('refuses what it cannot read', () => {
    expect(() => decodeBmp(new Uint8Array(54))).toThrow('not a BMP')
  })
})
