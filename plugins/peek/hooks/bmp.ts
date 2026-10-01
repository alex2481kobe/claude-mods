// Decodes the uncompressed 24- or 32-bit BMP that sips writes. Throws on
// anything else, naming what it found.

export type Pixels = {
  width: number
  height: number
  // Row-major, top row first, 4 bytes per pixel: r, g, b, and 0 for a
  // transparent pixel or 255 otherwise.
  rgba: Uint8Array
}

export const decodeBmp = (bytes: Uint8Array): Pixels => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 54 || view.getUint16(0, true) !== 0x4d42) throw new Error('not a BMP')

  const offset = view.getUint32(10, true)
  const width = view.getInt32(18, true)
  const rawHeight = view.getInt32(22, true)
  const bits = view.getUint16(28, true)
  const compression = view.getUint32(30, true)
  if (bits !== 24 && bits !== 32) throw new Error(`BMP of ${bits} bits per pixel`)
  if (compression !== 0 && compression !== 3) throw new Error(`BMP compression ${compression}`)

  const height = Math.abs(rawHeight)
  const isBottomUp = rawHeight > 0
  const step = bits / 8
  const stride = Math.ceil((width * step) / 4) * 4
  const rgba = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y++) {
    const row = offset + (isBottomUp ? height - 1 - y : y) * stride
    for (let x = 0; x < width; x++) {
      const at = row + x * step
      const to = (y * width + x) * 4
      rgba[to] = bytes[at + 2] ?? 0
      rgba[to + 1] = bytes[at + 1] ?? 0
      rgba[to + 2] = bytes[at] ?? 0
      rgba[to + 3] = bits === 32 && bytes[at + 3] === 0 ? 0 : 255
    }
  }
  return { width, height, rgba }
}
