import type { AgentSpawnInput, EngineInterface, Register } from 'claude-code'

import { definitionOf, labelOf, type Definition } from './label'

// Shows each Claude subagent's model and effort in the native agent list:
// ` · Opus 5.5 (high)` after its task, as the codex mod does for Codex.

// The effort of each loop's latest request: '' is the main loop.
const efforts = new Map<string, string>()

// Where agent files live: the project's own first, then the person's. A
// definition from anywhere else (settings, a flag, policy) is not read, and
// its agent goes unlabelled.
async function agentDirs($: EngineInterface, provider: string): Promise<string[]> {
  const home = await $.env.get('HOME')
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home && `${home}/.claude`)
  const user = config ? [`${config}/agents`] : []
  return provider === 'user' ? user : [`${await $.session.root()}/.claude/agents`, ...user]
}

async function definitionNamed($: EngineInterface, type: string, provider: string): Promise<Definition | undefined> {
  for (const dir of await agentDirs($, provider)) {
    const files = await $.fs.list(dir).catch(() => [])
    for (const file of files) {
      if (file.kind !== 'file' || !file.name.endsWith('.md')) continue
      const text = await $.fs.read(`${dir}/${file.name}`).catch(() => '')
      const definition = definitionOf(text, file.name)
      if (definition?.name === type) return definition
    }
  }
  return undefined
}

export const register: Register = on => {
  on('turn.step', async function* ($, e, next) {
    if (e.effort === undefined) efforts.delete(e.agentId ?? '')
    else efforts.set(e.agentId ?? '', String(e.effort))
    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    // The label is decoration: an agent starts whether or not it can be made.
    const label = await labelFor($, e).catch(() => undefined)
    return next(label ? { ...e, description: `${e.description} · ${label}` } : e)
  })
}

async function labelFor($: EngineInterface, e: AgentSpawnInput): Promise<string | undefined> {
  if (e.subagentType.includes(':')) return undefined
  const isBuiltIn = e.provider.plugin === 'engine'
  const definition = e.fork || isBuiltIn ? undefined : await definitionNamed($, e.subagentType, e.provider.plugin)
  const spawn = {
    type: e.subagentType,
    model: e.model,
    fork: e.fork,
    isBuiltIn,
    parentModel: e.parentModel,
    parentEffort: efforts.get(e.parentAgentId ?? ''),
  }
  return labelOf(spawn, definition)
}
