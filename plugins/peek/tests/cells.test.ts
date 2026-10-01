import { describe, expect, test } from 'claude-code/testing'

import { pictureOf } from '../hooks/cells'
import { TRANSPARENT } from '../hooks/palette'

const words = (cells: string) => Array.from(new Uint32Array(Uint8Array.fromBase64(cells).buffer))
const DEFAULT = 0x01000000

describe('cells', () => {
  test('two pixel rows per cell; transparent pixels take the terminal color', () => {
    // 2 wide, 3 tall: the odd last row pairs with nothing below it.
    const picture = pictureOf(Int32Array.of(0xff0000, TRANSPARENT, 0x0000ff, 0x0000ff, TRANSPARENT, 0xff0000), 2, 3)
    expect([picture.columns, picture.rows]).toEqual([2, 2])
    expect(words(picture.cells)).toEqual([
      0x2580, 0xff0000, 0x0000ff, // red over blue
      0x2584, 0x0000ff, DEFAULT, // clear over blue: lower half in blue
      0x20, DEFAULT, DEFAULT, // clear, nothing below
      0x2580, 0xff0000, DEFAULT, // red, nothing below
    ])
  })
})
