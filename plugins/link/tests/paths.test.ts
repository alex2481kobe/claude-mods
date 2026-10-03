import { describe, expect, test } from 'claude-code/testing'

import { absolute, candidates, hrefOf, linkify, targetOf } from '../hooks/paths'

describe('candidates', () => {
  test('finds absolute, home, dot and relative paths, without a :line', () => {
    const text = 'See /private/tmp/demo-app, ~/notes/a.md, ./app.js, ../up/b.ts, src/app.js and app.js:5.'
    expect(candidates(text)).toEqual(['/private/tmp/demo-app', '~/notes/a.md', './app.js', '../up/b.ts', 'src/app.js', 'app.js'])
  })

  test('takes a folder written with a trailing slash', () => {
    expect(candidates('Look in src/ and /tmp/x/.')).toEqual(['src/', '/tmp/x/'])
  })

  test('takes an absolute path with a hidden folder in the middle', () => {
    expect(candidates('See /a/b/.cache/c/d.txt now.')).toEqual(['/a/b/.cache/c/d.txt'])
  })

  test('takes a home path into a hidden folder', () => {
    expect(candidates('See ~/.claude/CLAUDE.md now.')).toEqual(['~/.claude/CLAUDE.md'])
  })

  test('takes a relative path ending in a dotfile', () => {
    expect(candidates('See src/.env now.')).toEqual(['src/.env'])
  })

  test('skips fenced code, autolinks, URLs and the labels of links', () => {
    const text = '```\ncat app.js\n```\n~~~\nb.ts\n~~~\n[c.ts](https://e.com) <https://x.dev/d.ts> https://e.com/f.ts'
    expect(candidates(text)).toEqual([])
  })

  test('takes hidden files and folders, and . and .. as steps', () => {
    expect(candidates('Built in /w/sapline-swift/.gocache/x/file.go today.')).toEqual(['/w/sapline-swift/.gocache/x/file.go'])
    expect(candidates('Set /w/.env and ~/.claude/CLAUDE.md first.')).toEqual(['/w/.env', '~/.claude/CLAUDE.md'])
    expect(candidates('Then src/../app.js and ./.config/a.ts.')).toEqual(['src/../app.js', './.config/a.ts'])
  })

  test('a path ending a sentence leaves the full stop out', () => {
    expect(candidates('see ~/.claude/CLAUDE.md.')).toEqual(['~/.claude/CLAUDE.md'])
  })

  test('a dotfile keeps its :line out of the path', () => {
    expect(candidates('Edit /w/.zshrc:12 and `.env:3` now.')).toEqual(['/w/.zshrc', '.env'])
  })

  test('takes the path a link written in the reply points at', () => {
    const text = '- [a](file:///w/a%20b.md) [r](/w/r.md) [s](src/s.ts#L3) [w](https://e.com/x.md) [h](#top) ![i](i.png)'
    expect(candidates(text)).toEqual(['/w/a b.md', '/w/r.md', 'src/s.ts'])
  })

  test('takes inline code that is one path, not code that holds one', () => {
    expect(candidates('Open `app.js:3` but not `node app.js`.')).toEqual(['app.js'])
  })

  test('a bare word, a version or a lone slash is not a path', () => {
    expect(candidates('Use and / or v1.2 now.')).toEqual([])
  })

  test('a path inside a longer token is not taken', () => {
    expect(candidates('Run scp user@host:/etc/hosts and keep app.js-old.')).toEqual([])
  })
})

describe('absolute', () => {
  test('resolves against the working directory and home, folding . and ..', () => {
    expect(absolute('src/../app.js', '/w/p', '/h')).toBe('/w/p/app.js')
    expect(absolute('./a/./b', '/w', '/h')).toBe('/w/a/b')
    expect(absolute('~/n.md', '/w', '/h')).toBe('/h/n.md')
    expect(absolute('/x/y/', '/w', '/h')).toBe('/x/y')
  })
})

describe('hrefs', () => {
  test('a file URL escapes what would end the link or the URL', () => {
    expect(hrefOf('/h/My Files (old)/a#1?.md', false)).toBe('file:///h/My%20Files%20%28old%29/a%231%3F.md')
  })

  test('a file is shown in its folder, a folder opened as itself', () => {
    expect(targetOf(hrefOf('/h/My Files (old)/a#1?.md', false))).toEqual({
      argv: ['open', '-R', '/h/My Files (old)/a#1?.md'],
      done: 'Revealed /h/My Files (old)/a#1?.md in Finder',
      failed: 'Could not reveal /h/My Files (old)/a#1?.md',
    })
    expect(hrefOf('/h/src', true)).toBe('file:///h/src/')
    expect(targetOf(hrefOf('/h/src', true))).toEqual({
      argv: ['open', '/h/src/'],
      done: 'Opened /h/src/ in Finder',
      failed: 'Could not open /h/src/',
    })
  })

  test('only a file URL names something to open', () => {
    expect(targetOf('https://example.com/a')).toBeUndefined()
  })
})

describe('linkify', () => {
  test('a file is code inside the link, a folder plain with a trailing slash', () => {
    const hrefs = new Map([['app.js', 'file:///w/app.js'], ['/w', 'file:///w/']])
    expect(linkify('Edit app.js:5 in /w, not b.js or [x](https://e.com).', hrefs)).toBe(
      'Edit [`app.js:5`](file:///w/app.js) in [/w/](file:///w/), not b.js or [x](https://e.com).',
    )
  })

  test('inline code is linked the same way, and fences are left alone', () => {
    const hrefs = new Map([['app.js', 'file:///w/app.js'], ['src/', 'file:///w/src/']])
    expect(linkify('Open `app.js` in `src/`.\n```\napp.js\n```', hrefs)).toBe(
      'Open [`app.js`](file:///w/app.js) in [src/](file:///w/src/).\n```\napp.js\n```',
    )
  })

  test('a link written in the reply keeps its label and points at the path', () => {
    const hrefs = new Map([['/w/a b.md', 'file:///w/a%20b.md'], ['/w/d', 'file:///w/d/']])
    expect(linkify('- [the a](file:///w/a%20b.md)\n- [d](/w/d) and [web](https://e.com) [gone](/w/gone)', hrefs)).toBe(
      '- [the a](file:///w/a%20b.md)\n- [d](file:///w/d/) and [web](https://e.com) [gone](/w/gone)',
    )
  })

  test('a dotfile label keeps its :line', () => {
    const hrefs = new Map([['/w/.zshrc', 'file:///w/.zshrc']])
    expect(linkify('Edit /w/.zshrc:12.', hrefs)).toBe('Edit [`/w/.zshrc:12`](file:///w/.zshrc).')
  })

  test('links a full path through a hidden folder', () => {
    const hrefs = new Map([['/a/b/.cache/c/d.txt', 'file:///a/b/.cache/c/d.txt']])
    expect(linkify('See /a/b/.cache/c/d.txt now.', hrefs)).toBe('See [`/a/b/.cache/c/d.txt`](file:///a/b/.cache/c/d.txt) now.')
  })

  test('a long label shows its last two names, keeping the :line', () => {
    const file = '/private/tmp/demo-app/hooks/register.ts'
    const folder = '/srv/shared/projects/demo-app/assets'
    const hrefs = new Map([[file, hrefOf(file, false)], [folder, hrefOf(folder, true)], ['src/a.ts', 'file:///w/src/a.ts']])
    expect(linkify(`See ${file}:12, ${folder} and src/a.ts.`, hrefs)).toBe(
      `See [\`\u2026/hooks/register.ts:12\`](${hrefOf(file, false)}), [\u2026/demo-app/assets/](${hrefOf(folder, true)}) and [\`src/a.ts\`](file:///w/src/a.ts).`,
    )
  })

  test('a folder label escapes what markdown would read as emphasis', () => {
    const hrefs = new Map([['~/_cache_', 'file:///h/_cache_/']])
    expect(linkify('Clear ~/_cache_ now.', hrefs)).toBe('Clear [\\~/\\_cache\\_/](file:///h/_cache_/) now.')
  })
})
