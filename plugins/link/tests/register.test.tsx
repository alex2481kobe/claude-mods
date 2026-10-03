import type { On, RenderElement, RenderNode } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

const CWD = '/w'
const THERE = new Set(['/w/app.js', '/w', '/h/n.md', '/w/locked.js'])

// The engine beneath the plugin: a working directory, a home, a disk, and its
// own drawing of a reply, which a reply left alone comes back as.
const ENGINE: RenderElement = { type: 'Text', props: {}, children: ['engine'] }

const fake = (on: On, runs: string[][], toasts: string[] = []) => {
  on('ui.render', () => ENGINE)
  on('session.cwd', () => ({ value: CWD }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/h' : undefined }))
  on('fs.stat', (_$, e) => {
    if (!THERE.has(e.path)) return { deny: 'ENOENT' }
    return { value: { kind: e.path === '/w' ? 'dir' : 'file', size: 1, mtimeMs: 0, isLink: false } }
  })
  on('process.run', (_$, e) => {
    runs.push([...e.argv])
    const isLocked = e.argv.includes('/w/locked.js')
    const stderr = isLocked ? 'not permitted\n' : ''
    return { value: { exitCode: isLocked ? 1 : 0, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
}

// The Markdown a drawing holds, wherever it sits in the tree.
const markdownOf = (node: RenderNode): RenderNode | undefined =>
  typeof node === 'string' || node.type === 'engine'
    ? undefined
    : node.type === 'Markdown'
      ? node
      : 'children' in node
        ? (node.children ?? []).map(markdownOf).find(Boolean)
        : undefined

const reply = ($: Engine, text: string, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.render({ surface, component: 'AssistantMessage', requestId: 'm1', props: { text, isFirstOfReply: true } })

test('links the paths that exist and opens the pressed one, saying where', async ($, on) => {
  const runs: string[][] = []
  const toasts: string[] = []
  fake(on, runs, toasts)
  const tree = await reply($, 'Edit app.js:5 in /w and ~/n.md, not gone.js.')
  expect(markdownOf(tree)).toEqual(
    expect.objectContaining({
      type: 'Markdown',
      props: expect.objectContaining({
        key: 'link',
        text: 'Edit [`app.js:5`](file:///w/app.js) in [/w/](file:///w/) and [`~/n.md`](file:///h/n.md), not gone.js.',
        pressableLinks: ['file:///w/app.js', 'file:///w/', 'file:///h/n.md'],
      }),
    }),
  )
  await $.ui.press({ plugin: 'link', key: 'link', link: { href: 'file:///w/app.js' } })
  await $.ui.press({ plugin: 'link', key: 'link', link: { href: 'file:///w/' } })
  expect(runs).toEqual([
    ['open', '-R', '/w/app.js'],
    ['open', '/w/'],
  ])
  expect(toasts).toEqual(['Revealed /w/app.js in Finder', 'Opened /w/ in Finder'])
})

test('a file link the reply wrote itself is pressed like one the mod drew', async ($, on) => {
  const runs: string[][] = []
  fake(on, runs)
  const tree = await reply($, 'Found:\n- [app](file:///w/app.js)\n- [here](/w)')
  expect(markdownOf(tree)).toEqual(
    expect.objectContaining({
      props: expect.objectContaining({
        text: 'Found:\n- [app](file:///w/app.js)\n- [here](file:///w/)',
        pressableLinks: ['file:///w/app.js', 'file:///w/'],
      }),
    }),
  )
  await $.ui.press({ plugin: 'link', key: 'link', link: { href: 'file:///w/app.js' } })
  expect(runs).toEqual([['open', '-R', '/w/app.js']])
})

test('a press that fails says so instead', async ($, on) => {
  const toasts: string[] = []
  fake(on, [], toasts)
  await reply($, 'See locked.js.')
  await $.ui.press({ plugin: 'link', key: 'link', link: { href: 'file:///w/locked.js' } })
  expect(toasts).toEqual(['Could not reveal /w/locked.js: not permitted'])
})

test('leaves a reply with nothing to link, off the terminal or too long, to the engine', async ($, on) => {
  fake(on, [])
  expect(await reply($, 'Nothing here, not even gone.js.')).toEqual(ENGINE)
  expect(await reply($, 'Edit app.js.', 'desktop')).toEqual(ENGINE)
  expect(await reply($, `Edit app.js. ${'x'.repeat(10000)}`)).toEqual(ENGINE)
})
