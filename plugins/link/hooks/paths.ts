// Finds the file paths a reply's markdown writes and turns them into file:
// links. Pure: the caller decides which paths exist and passes their hrefs in.

// One name in a path: letters, digits and `_ . @ + -`, at most one leading dot
// (`.claude`, `.env`) and never ending in one, so the full stop after a path
// is not part of it. A folder step may also be `.` or `..`.
const SEG = String.raw`\.?[\w@+-](?:[\w.@+-]*[\w@+-])?`
const DIR = String.raw`(?:${SEG}|\.{1,2})`
// Rooted (`/a`, `~/a`, `./a`, `../a`), relative with a slash (`src/a.js`,
// `src/`), a bare file name with an extension (`app.js`), or a dotfile (`.env`).
const PATH = [
  String.raw`(?:~|\.{1,2})?\/(?:${DIR}\/)*${SEG}\/?`,
  String.raw`${SEG}(?:\/${DIR})*\/(?:${SEG})?`,
  String.raw`[\w@+-]+(?:\.[\w@+-]+)*\.[A-Za-z][A-Za-z0-9]{0,9}`,
  String.raw`\.[A-Za-z][\w@+-]*`,
].join('|')
const LINE = String.raw`(?::\d+(?::\d+)?)?`

// Bounded so a path inside a longer word, URL or path is not taken.
const IN_TEXT = new RegExp(String.raw`(?<![\w/.~@+:-])(${PATH})${LINE}(?![\w/@+-])`, 'g')
const WHOLE = new RegExp(String.raw`^(${PATH})${LINE}$`)

// Spans never rewritten inside: code fences, links, autolinks, bare URLs, and
// inline code, which is linked whole when it is exactly one path.
const SPANS = /(```|~~~)[\s\S]*?(?:\1|$)|!?\[[^\]\n]*\]\([^)\n]*\)|<[a-z]+:[^>\n]*>|[a-z][a-z0-9+.-]*:\/\/[^\s)]+|`[^`\n]+`/g

type Part = { text: string; isFree: boolean }

const split = (text: string): Part[] => {
  const parts: Part[] = []
  let at = 0
  for (const m of text.matchAll(SPANS)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index), isFree: true })
    parts.push({ text: m[0], isFree: false })
    at = m.index + m[0].length
  }
  if (at < text.length) parts.push({ text: text.slice(at), isFree: true })
  return parts
}

const codePath = (span: string): string | undefined =>
  span.startsWith('`') && !span.startsWith('``') ? WHOLE.exec(span.slice(1, -1))?.[1] : undefined

const LINK = /^\[([^\]\n]*)\]\(([^)\n]*)\)$/
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

const decoded = (text: string): string | undefined => {
  try {
    return decodeURIComponent(text)
  } catch {
    return undefined
  }
}

// What a link the reply wrote itself points at, when that is a path: a
// `file:` URL, or a target with no scheme (`/a/b.md`, `src/a.ts#L3`).
const linkPath = (span: string): string | undefined => {
  const target = (LINK.exec(span)?.[2] ?? '').trim().replace(/[#?].*$/, '')
  if (target.startsWith('file:///')) return decoded(target.slice('file://'.length))
  if (target === '' || SCHEME.test(target)) return undefined
  return decoded(target.replace(/:\d+(?::\d+)?$/, ''))
}

// Each distinct path the text writes, as written less its `:line`, in order:
// in its prose, as inline code, or as the target of a link it wrote.
export const candidates = (text: string): string[] => {
  const found = new Set<string>()
  for (const part of split(text)) {
    if (part.isFree) {
      for (const m of part.text.matchAll(IN_TEXT)) found.add(m[1] ?? '')
    } else {
      found.add(codePath(part.text) ?? linkPath(part.text) ?? '')
    }
  }
  found.delete('')
  return [...found]
}

// Past this many characters a label shows only its last two names.
const LONG_LABEL = 32

// What a link to `path` (as written, `line` after it) shows: a file as inline
// code, a folder as plain text ending in a slash, a long one cut to `.../a/b`.
const labelOf = (path: string, line: string, isFolder: boolean): string => {
  const bare = path.replace(/\/$/, '')
  const names = bare.split('/')
  const isLong = bare.length + line.length > LONG_LABEL && names.length > 2
  const shown = isLong ? `\u2026/${names.slice(-2).join('/')}` : bare
  return isFolder ? `${shown.replace(/[\\_~*]/g, '\\$&')}/` : `\`${shown}${line}\``
}

const linkOf = (path: string, line: string, href: string) => `[${labelOf(path, line, href.endsWith('/'))}](${href})`

// The text with each path `hrefs` holds made a link to its href; a link the
// reply wrote keeps its label and gets the href.
export const linkify = (text: string, hrefs: ReadonlyMap<string, string>): string =>
  split(text)
    .map(part => {
      if (part.isFree) {
        return part.text.replace(IN_TEXT, (all, path: string) => {
          const href = hrefs.get(path)
          return href === undefined ? all : linkOf(path, all.slice(path.length), href)
        })
      }
      const code = codePath(part.text)
      const href = hrefs.get(code ?? linkPath(part.text) ?? '')
      if (href === undefined) return part.text
      if (code !== undefined) return linkOf(code, part.text.slice(1 + code.length, -1), href)
      return `[${LINK.exec(part.text)?.[1] ?? ''}](${href})`
    })
    .join('')

// `~` as `home`, a relative path under `cwd`, `.` and `..` folded away.
export const absolute = (path: string, cwd: string, home: string): string => {
  const full = path === '~' || path.startsWith('~/') ? home + path.slice(1) : path.startsWith('/') ? path : `${cwd}/${path}`
  const out: string[] = []
  for (const seg of full.split('/')) {
    if (seg === '..') out.pop()
    else if (seg !== '' && seg !== '.') out.push(seg)
  }
  return `/${out.join('/')}`
}

// Every name escaped, parentheses too, so the href cannot end the markdown link.
const escape = (seg: string) => encodeURIComponent(seg).replace(/[()!*']/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

// A folder's URL ends in a slash, as file URLs write one, which is how a press
// tells a folder from a file.
export const hrefOf = (path: string, isFolder: boolean): string =>
  `file://${path.split('/').map(escape).join('/')}${isFolder && path !== '/' ? '/' : ''}`

export type Target = { argv: string[]; done: string; failed: string }

// What a press on `href` runs, Finder showing a file selected in its folder or
// a folder opened as itself, and what to say after; nothing for another link.
export const targetOf = (href: string): Target | undefined => {
  if (!href.startsWith('file:///')) return undefined
  const path = decodeURIComponent(href.slice('file://'.length))
  return href.endsWith('/')
    ? { argv: ['open', path], done: `Opened ${path} in Finder`, failed: `Could not open ${path}` }
    : { argv: ['open', '-R', path], done: `Revealed ${path} in Finder`, failed: `Could not reveal ${path}` }
}
