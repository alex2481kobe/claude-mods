// What a subagent runs on, worked out before it starts: the agent list shows
// the spawn's description, and only a rewrite made before the spawn shows.

// An agent file's frontmatter, as far as the label needs it.
export type Definition = { name: string; model?: string; effort?: string }

export type Spawn = {
  type: string
  // The Agent tool's `model` parameter, when given.
  model?: string
  fork: boolean
  isBuiltIn: boolean
  parentModel: string
  // The effort of the parent's latest request, when its model has one.
  parentEffort?: string
}

// Built-in types that run on the parent's model and effort.
const INHERITS = new Set(['general-purpose'])

// The frontmatter of an agent file: its `name` (else the file's name), and
// `model` and `effort` when set. A file without frontmatter is no agent.
export function definitionOf(text: string, fileName: string): Definition | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!match) return undefined
  const fields: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z]+):\s*(.*?)\s*$/.exec(line)
    if (field) fields[field[1]!] = field[2]!.replace(/^(["'])(.*)\1$/, '$2')
  }
  const name = fields.name || fileName.replace(/\.md$/, '')
  return { name, model: fields.model || undefined, effort: fields.effort || undefined }
}

// Claude model ids as people say them: `claude-opus-5-5` reads `Opus 5.5`,
// a dated id like `claude-haiku-4-5-20251001` reads `Haiku 4.5`, an alias
// like `haiku` reads `Haiku`. Anything else is shown as it is.
export function nameOf(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?(\[1m\])?$/i.exec(id)
  const word = /^[a-z]+$/.test(id) ? id : match?.[1]
  if (!word) return id
  const name = `${word[0]!.toUpperCase()}${word.slice(1)}`
  return match ? `${name} ${match[2]}.${match[3]}` : name
}

// The label for the agent list, e.g. `Opus 5.5 (high)`, or undefined when
// the model cannot be known here. Plugin types (`codex:read`) label
// themselves. Effort shows only where it is known to carry over: the
// definition sets it, or the agent runs on the parent's own model.
export function labelOf(spawn: Spawn, definition?: Definition): string | undefined {
  if (spawn.type.includes(':')) return undefined
  const chosen = spawn.fork ? undefined : (spawn.model ?? definition?.model)
  const inherits = spawn.fork || chosen === 'inherit' || (!chosen && spawn.isBuiltIn && INHERITS.has(spawn.type))
  const model = inherits ? spawn.parentModel : chosen
  if (!model) return undefined
  const effort = definition?.effort ?? (model === spawn.parentModel ? spawn.parentEffort : undefined)
  return effort ? `${nameOf(model)} (${effort})` : nameOf(model)
}
