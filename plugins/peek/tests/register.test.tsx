import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

tier('user')

// A 2x2 32-bit BMP, top-down: what the fake sips "writes".
const BMP = (() => {
  const bytes = new Uint8Array(54 + 16)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0x4d42, true)
  view.setUint32(10, 54, true)
  view.setInt32(18, 2, true)
  view.setInt32(22, -2, true)
  view.setUint16(28, 32, true)
  bytes.fill(255, 54)
  return bytes.toBase64()
})()

type Image = { width: number; height: number; format: string }

// The world beneath the mod: env, files, and a sips that records its calls.
const world = (on: On, env: Record<string, string>, images: Record<string, Image>, sipsFails = false) => {
  const runs: string[][] = []
  const written = new Set<string>()
  mock.env(on, { HOME: '/Users/me', TMPDIR: '/tmp/', ...env })
  on('clock.now', () => ({ value: 1 }))
  on('fs.exists', ($, e) => ({ value: e.path in images || written.has(e.path) }))
  on('fs.read', () => ({ value: { base64: BMP } }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    runs.push(argv)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] !== 'sips') return ok()
    if (sipsFails) return { value: { exitCode: 1, stdout: '', stderr: 'sips: broken', isStdoutTruncated: false, isStderrTruncated: false } }
    const out = argv[argv.indexOf('--out') + 1]
    if (argv.includes('--out') && out !== undefined) written.add(out)
    const image = images[argv[argv.length - 1] ?? '']
    return image === undefined
      ? ok()
      : ok(`  pixelWidth: ${image.width}\n  pixelHeight: ${image.height}\n  format: ${image.format}\n`)
  })
  // Stands for the engine's own drawing of the output row.
  on('ui.render', { component: 'CommandOutput' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  return runs
}

const peek = async ($: Engine, args: string) => {
  const { text = '' } = await $.command.run({
    command: 'peek',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  } as Parameters<typeof $.command.run>[0])
  const ui = await $.ui.mount({
    plugin: 'peek',
    surface: 'terminal',
    component: 'CommandOutput',
    props: { command: 'peek', args, text, isErrored: false },
  })
  return { text, ui }
}

describe('register', () => {
  test('in Ghostty a JPEG is converted to a kept PNG and drawn as an Image', async ($, on) => {
    const runs = world(on, { TERM_PROGRAM: 'ghostty' }, { '/pics/a.jpg': { width: 1600, height: 560, format: 'jpeg' } })
    const { text, ui } = await peek($, '/pics/a.jpg')

    const convert = runs.find(argv => argv.includes('png'))
    const png = convert?.[convert.indexOf('--out') + 1]
    expect(png).toMatch(/^\/tmp\/peek\/.+\.png$/)
    expect(runs.some(argv => argv[0] === 'rm' && argv.includes(png ?? ''))).toBe(false)

    const image = await ui.find({ type: 'Image' })
    expect(image?.props.source).toEqual({ file: png, format: 'png' })
    // 116 columns (120 less 4) by 1600:560 at two-to-one cells is 20 rows.
    expect([image?.props.columns, image?.props.rows]).toEqual([116, 20])
    expect(text).toContain('drawn as a picture')
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  })

  test('in kitty even a PNG is drawn from a local copy, never the original path', async ($, on) => {
    const runs = world(on, { KITTY_WINDOW_ID: '1' }, { '/Volumes/share/b.png': { width: 100, height: 100, format: 'png' } })
    const { ui } = await peek($, '/Volumes/share/b.png')
    const source = (await ui.find({ type: 'Image' }))?.props.source as { file: string } | undefined
    expect(source?.file).toMatch(/^\/tmp\/peek\/.+\.png$/)
    expect(runs.some(argv => argv.includes('--out') && argv.includes('/Volumes/share/b.png'))).toBe(true)
  })

  test('elsewhere the image is drawn as Raster cells and the BMP is removed', async ($, on) => {
    const runs = world(on, { TERM_PROGRAM: 'Apple_Terminal' }, { '/pics/c.png': { width: 4, height: 4, format: 'png' } })
    const { text, ui } = await peek($, '/pics/c.png')
    const raster = await ui.find({ type: 'Raster' })
    expect([raster?.props.columns, raster?.props.rows]).toEqual([2, 1])
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect(text).toContain('px preview')
    const bmp = runs.find(argv => argv.includes('bmp'))
    const out = bmp?.[bmp.indexOf('--out') + 1]
    expect(runs.some(argv => argv[0] === 'rm' && argv.includes(out ?? ''))).toBe(true)
  })

  test('a missing file says so and draws nothing', async ($, on) => {
    world(on, { TERM_PROGRAM: 'ghostty' }, {})
    const missing = await peek($, '/pics/none.png')
    expect(missing.text).toContain('no such file: /pics/none.png')
    expect(await missing.ui.find({ type: 'Image' })).toBeUndefined()
  })

  test('a file sips cannot read is reported', async ($, on) => {
    world(on, { TERM_PROGRAM: 'Apple_Terminal' }, { '/pics/d.txt': { width: 1, height: 1, format: 'text' } }, true)
    const { text, ui } = await peek($, '/pics/d.txt')
    expect(text).toContain('could not read /pics/d.txt')
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  })

  test('~ is the home folder', async ($, on) => {
    world(on, { KITTY_WINDOW_ID: '1' }, { '/Users/me/e.png': { width: 10, height: 10, format: 'png' } })
    const { text } = await peek($, '~/e.png')
    expect(text).toContain('/Users/me/e.png')
  })
})
