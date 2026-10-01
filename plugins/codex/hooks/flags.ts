// A codex agent's prompt may open with Codex CLI flags, one per line, spelled
// as `codex exec --help` spells them without the dashes: `model: gpt-6-astra`,
// `sandbox: workspace-write`, `approve-for-me`, `config: key=value`. They
// choose how Codex runs and are not part of the task. Codex's own config fills
// in everything not chosen.

export type Flags = {
  // Arguments for `codex app-server`: config overrides and feature switches.
  args: string[]
  model?: string
  effort?: string
  cwd?: string
  ephemeral?: boolean
  images: string[]
  outputSchema?: string
  addDirs: string[]
  prompt: string
}

export type Parsed = Flags | { error: string }

// What the read and write types pin: a flag that changes it is refused there.
export type Pin = { sandbox: string }

const WORD = /^[A-Za-z0-9._/:@+-]+$/
const CONFIG = /^[A-Za-z0-9_.-]+=.+$/
const PINNED = /^(sandbox_mode|approval_policy|approvals_reviewer|sandbox_workspace_write)\b/

const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVALS = ['untrusted', 'on-request', 'never']

// `codex exec` flags that have no meaning for a session the mod drives.
const EXEC_ONLY: Record<string, string> = {
  profile: 'codex app-server takes no --profile; set the values with config: lines',
  json: 'the mod already reads Codex events',
  'output-last-message': 'the report goes back to Claude',
  color: 'there is no terminal',
  'skip-git-repo-check': 'the mod never needs a git repo',
  worktree: 'codex app-server takes no --worktree',
  'ignore-user-config': 'codex app-server takes no --ignore-user-config',
  'ignore-rules': 'codex app-server takes no --ignore-rules',
  'dangerously-bypass-hook-trust': 'codex app-server takes no --dangerously-bypass-hook-trust',
  oss: 'name the provider with local-provider: lmstudio or ollama',
}

const ALIASES: Record<string, string> = {
  m: 'model',
  s: 'sandbox',
  a: 'ask-for-approval',
  approval: 'ask-for-approval',
  c: 'config',
  C: 'cd',
  i: 'image',
  auto: 'approve-for-me',
  'reasoning-effort': 'effort',
}

// `--sandbox read-only`, `-s=read-only`, `sandbox: read-only`, or a flag that
// takes no value alone on its line (`approve-for-me`). Prose never matches:
// "search the code" has neither the dashes nor the colon.
const DASHED = /^--?([A-Za-z][A-Za-z-]*)(?:[ =]\s*(.*))?$/
const PLAIN = /^([A-Za-z][A-Za-z-]*)(?::\s*(.*))?$/

type Apply = (flags: Flags, value: string) => string | undefined

function quoted(key: string, value: string, flags: Flags): string | undefined {
  if (!WORD.test(value)) return `${key} needs a plain value, not "${value}"`
  flags.args.push('-c', `${key}="${value}"`)
}

function oneOf(key: string, allowed: string[]): Apply {
  return (flags, value) => (allowed.includes(value) ? quoted(key, value, flags) : `${key} is one of ${allowed.join(', ')}`)
}

const FLAGS: Record<string, { apply: Apply; pinned?: true; bare?: true }> = {
  model: { apply: (f, v) => quoted('model', v, f) ?? void (f.model = v) },
  effort: { apply: (f, v) => quoted('model_reasoning_effort', v, f) ?? void (f.effort = v) },
  sandbox: { apply: oneOf('sandbox_mode', SANDBOXES), pinned: true },
  'ask-for-approval': { apply: oneOf('approval_policy', APPROVALS), pinned: true },
  // As `codex exec --approve-for-me`: Codex's automatic reviewer decides, in
  // the workspace-write sandbox.
  'approve-for-me': {
    apply: f => void f.args.push('-c', 'approvals_reviewer="auto_review"', '-c', 'sandbox_mode="workspace-write"'),
    pinned: true,
    bare: true,
  },
  'dangerously-bypass-approvals-and-sandbox': {
    apply: f => void f.args.push('-c', 'sandbox_mode="danger-full-access"', '-c', 'approval_policy="never"'),
    pinned: true,
    bare: true,
  },
  'add-dir': { apply: (f, v) => void f.addDirs.push(v), pinned: true },
  search: { apply: f => void f.args.push('-c', 'web_search="live"'), bare: true },
  'local-provider': { apply: (f, v) => quoted('model_provider', v, f) },
  config: {
    apply: (f, v) => (CONFIG.test(v) ? void f.args.push('-c', v) : `config takes key=value, not "${v}"`),
  },
  enable: { apply: (f, v) => (WORD.test(v) ? void f.args.push('--enable', v) : `enable takes a feature name`) },
  disable: { apply: (f, v) => (WORD.test(v) ? void f.args.push('--disable', v) : `disable takes a feature name`) },
  'strict-config': { apply: f => void f.args.push('--strict-config'), bare: true },
  ephemeral: { apply: f => void (f.ephemeral = true), bare: true },
  cd: { apply: (f, v) => void (f.cwd = v) },
  image: { apply: (f, v) => void f.images.push(v) },
  'output-schema': { apply: (f, v) => void (f.outputSchema = v) },
}

export const FLAG_NAMES = Object.keys(FLAGS)

// Reads the leading flag lines of a prompt. A line that is not a known flag
// ends them; a known flag used wrongly, or one a pinned type refuses, is an
// error for the caller rather than a silent change of what Codex runs with.
export function flagsOf(text: string, pin?: Pin): Parsed {
  const flags: Flags = { args: [], images: [], addDirs: [], prompt: text }
  if (pin) flags.args.push('-c', `sandbox_mode="${pin.sandbox}"`, '-c', 'approval_policy="never"')
  const lines = text.split('\n')
  let used = 0
  for (const line of lines) {
    const match = DASHED.exec(line.trim()) ?? PLAIN.exec(line.trim())
    if (!match) break
    const name = ALIASES[match[1]!] ?? match[1]!
    const value = (match[2] ?? '').trim()
    if (name in EXEC_ONLY) return { error: `${name}: ${EXEC_ONLY[name]}` }
    const flag = FLAGS[name]
    if (!flag) break
    if (pin && (flag.pinned || (name === 'config' && PINNED.test(value)))) {
      return { error: `${name}: this agent type pins the ${pin.sandbox} sandbox; use codex:run to choose` }
    }
    if (!flag.bare && value === '') return { error: `${name} needs a value` }
    if (flag.bare && value !== '' && !/^(true|yes|on)$/i.test(value)) return { error: `${name} takes no value` }
    const error = flag.apply(flags, value)
    if (error) return { error }
    used++
  }
  flags.prompt = lines.slice(used).join('\n').trim()
  return flags
}
