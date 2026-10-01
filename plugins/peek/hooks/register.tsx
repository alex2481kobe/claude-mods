import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Picture } from '../types'
import { decodeBmp } from './bmp'
import { pictureOf } from './cells'
import { quantize } from './palette'

// Pictures by the row that shows them: `command:<args>` for /peek, the
// tool_use_id for the model's show tool.
const pictures = atom({ plugin: 'peek', key: 'pictures' } as const, {})

const TOOL = 'mcp__peek__show'
const MAX_COLUMNS = 160

const DESCRIPTION = [
  'Shows an image file to the user, drawn inline in their terminal.',
  'Reading an image only lets you see it; the user sees nothing. When the user asks to see, view or',
  'look at an image, call this tool (you may also Read it to describe it).',
  'The user may have no other way to see images from this session, so call it whenever you create,',
  'download, capture, edit or point to an image they should look at: screenshots, renders, charts,',
  'photos, generated assets, before/after comparisons. Show the image itself rather than describing',
  "it. It is a low-resolution preview: fine text in it will not be readable, so say what it contains.",
  'Accepts PNG, JPEG, HEIC, GIF, TIFF, BMP and other formats macOS can open.',
].join(' ')

// The tool may be deferred, its description unseen until loaded, so the
// system prompt says when to reach for it.
const GUIDANCE = [
  `# Showing images`,
  `The user is in a terminal and may have no other way to see image files. To let them see an image,`,
  `one you made, downloaded or captured, or one they ask to see, call ${TOOL} with its path: it draws`,
  `a preview inline. Reading an image lets only you see it, and \`open\` pops up a window they may not be watching.`,
].join('\n')

export const register: Register = on => {
  // The width the last command reported; the model's tool call carries none.
  let columns = 100

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command
      .register({ name: 'peek', description: 'Draw an image in the transcript: /peek <path>', immediate: true })
      .catch(err => $.ui.log(`peek: /peek not registered: ${err}`))
    await $.tool
      .register({
        name: 'show',
        description: DESCRIPTION,
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute path, or relative to the working directory' } },
          required: ['path'],
        },
      })
      .catch(err => $.ui.log(`peek: show tool not registered: ${err}`))
    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!e.surfaces.includes('terminal')) return result
    return { sections: [...result.sections, { id: 'peek:show', text: GUIDANCE, scope: 'session' as const }] }
  })

  on('command.run', { command: 'peek' }, async ($, e) => {
    columns = e.presentation.columns
    const path = await expand($, e.args)
    if (path === '') return { text: 'Usage: /peek <path to an image>' }
    try {
      return { text: `${path} ${describe(await keep($, `command:${e.args}`, path, columns))}` }
    } catch (err) {
      return { text: err instanceof Error ? err.message : String(err) }
    }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const path = await expand($, typeof e.path === 'string' ? e.path : '')
    try {
      const text = `Shown to the user: ${path} ${describe(await keep($, e.tool_use_id, path, columns))}.`
      return { result: text, text }
    } catch (err) {
      const text = `Could not show ${path || 'the image'}: ${err instanceof Error ? err.message : String(err)}`
      return { result: text, text, isError: true }
    }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'peek' } }, async ($, e, next) => {
    const picture = (await read($, pictures))[`command:${e.props.args}`]
    if (picture === undefined || e.surface !== 'terminal') return next(e)
    const { Box, Image, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        {picture.kind === 'photo' ? (
          <Image key="picture" source={{ file: picture.file, format: 'png' }} columns={picture.columns} rows={picture.rows} alt={picture.file} />
        ) : (
          <Raster key="picture" columns={picture.columns} rows={picture.rows} cells={picture.cells} />
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse', props: { tool: TOOL } }, async ($, e, next) => {
    const picture = (await read($, pictures))[e.requestId]
    if (picture === undefined || e.surface !== 'terminal') return next(e)
    const { Box, Image, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        {picture.kind === 'photo' ? (
          <Image key="picture" source={{ file: picture.file, format: 'png' }} columns={picture.columns} rows={picture.rows} alt={picture.file} />
        ) : (
          <Raster key="picture" columns={picture.columns} rows={picture.rows} cells={picture.cells} />
        )}
      </Box>
    )
  })
}

const describe = (picture: Picture) =>
  picture.kind === 'photo'
    ? `(drawn as a picture, ${picture.columns}x${picture.rows} cells)`
    : `(${picture.columns}x${picture.rows * 2} px preview)`

// Loads the picture and keeps it for the row that shows it.
const keep = async ($: EngineInterface, key: string, path: string, columns: number) => {
  const picture = await loadPicture($, path, Math.min(MAX_COLUMNS, columns - 4))
  await update($, pictures, all => ({ ...all, [key]: picture }))
  return picture
}

// `~` as the home folder, a relative path under the session's directory: the
// terminal reads a photo's file itself, so it needs an absolute path.
const expand = async ($: EngineInterface, raw: string) => {
  const path = raw.trim().replace(/^~(?=\/|$)/, (await $.env.get('HOME')) ?? '')
  return path === '' || path.startsWith('/') ? path : `${await $.session.cwd()}/${path}`
}

const MAX_ROWS = 48 // cell rows
const DITHER = 0.25

// Reads any image sips can open (PNG, JPEG, HEIC, GIF, TIFF, ...) and fits it
// to `columns` cells across and MAX_ROWS down: as a PNG the terminal draws
// itself where it has kitty graphics, as Raster cells elsewhere. Throws an
// Error whose message is fit to show the person.
const loadPicture = async ($: EngineInterface, path: string, columns: number): Promise<Picture> => {
  // sips only warns, and exits 0, on a file it cannot open.
  if (!(await $.fs.exists(path).catch(() => false))) throw new Error(`no such file: ${path}`)
  const [width, height] = await probe($, path)
  return (await hasKittyGraphics($))
    ? loadPhoto($, path, width, height, columns)
    : loadCells($, path, width, height, columns)
}

// The Image element draws real pixels on kitty and Ghostty, and its alt text
// elsewhere; each says so in its environment.
const hasKittyGraphics = async ($: EngineInterface) =>
  (await $.env.get('TERM_PROGRAM')) === 'ghostty' || (await $.env.get('KITTY_WINDOW_ID')) !== undefined

// A box of cells as wide as fits that keeps the picture's aspect: a cell is
// about twice as tall as it is wide. The terminal reads the file at every
// draw, and the engine refuses a file on a network or device path, so it
// always draws a local PNG copy, kept for the session.
const loadPhoto = async ($: EngineInterface, path: string, width: number, height: number, columns: number): Promise<Picture> => {
  const dir = `${await tmpdir($)}peek`
  await $.process.run(['mkdir', '-p', dir])
  const file = `${dir}/${await $.clock.now()}-${Math.random().toString(36).slice(2)}.png`
  const sips = await $.process.run(['sips', '-s', 'format', 'png', path, '--out', file])
  if (sips.exitCode !== 0 || !(await $.fs.exists(file))) {
    throw new Error(`could not read ${path} as an image: ${sips.stderr.trim() || sips.stdout.trim()}`)
  }
  const cols = Math.max(1, Math.min(columns, 255, Math.round((MAX_ROWS * 2 * width) / height)))
  const rows = Math.max(1, Math.min(MAX_ROWS, Math.round((cols * height) / width / 2)))
  return { kind: 'photo', columns: cols, rows, file }
}

const loadCells = async ($: EngineInterface, path: string, width: number, height: number, columns: number) => {
  // sips (built into macOS) writes an uncompressed BMP, which needs no
  // decoder library to read. A half-block pixel is about square.
  const scale = Math.min(columns / width, (MAX_ROWS * 2) / height, 1)
  const size = [height, width].map(n => String(Math.max(1, Math.round(n * scale))))
  const tmp = `${await tmpdir($)}peek-${await $.clock.now()}-${Math.random().toString(36).slice(2)}.bmp`
  try {
    const sips = await $.process.run(['sips', '-s', 'format', 'bmp', '--resampleHeightWidth', ...size, path, '--out', tmp])
    if (sips.exitCode !== 0 || !(await $.fs.exists(tmp))) {
      throw new Error(`could not read ${path} as an image: ${sips.stderr.trim() || sips.stdout.trim()}`)
    }
    const { base64 } = await $.fs.read(tmp, { as: 'bytes' })
    const pixels = decodeBmp(Uint8Array.fromBase64(base64))
    return pictureOf(quantize(pixels, DITHER), pixels.width, pixels.height)
  } finally {
    await $.process.run(['rm', '-f', tmp]).catch(() => undefined)
  }
}

const tmpdir = async ($: EngineInterface) => ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/?$/, '/')

// The image's pixel width and height, as sips reads them.
const probe = async ($: EngineInterface, path: string): Promise<[number, number]> => {
  const info = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path])
  const width = Number(/pixelWidth: (\d+)/.exec(info.stdout)?.[1] ?? 0)
  const height = Number(/pixelHeight: (\d+)/.exec(info.stdout)?.[1] ?? 0)
  if (width === 0 || height === 0) throw new Error(`could not read ${path} as an image`)
  return [width, height]
}
