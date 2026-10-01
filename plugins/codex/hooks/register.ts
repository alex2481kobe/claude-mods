import type { EngineInterface, Register } from 'claude-code'

import { specsOf, TYPES } from './agents'
import { flagsOf } from './flags'
import { codexConfig, codexModels, labelOf, type Files } from './model'
import { closeHeld, step } from './step'

// Codex as native subagent types. The Agent tool starts one like any other
// subagent (task list, background, SendMessage); a turn.step hook answers its
// loop's model request by driving `codex app-server`, streaming what Codex
// does into the agent's transcript, then hands Codex's answer back. What
// Codex asks on the way (an approval, a question) is handed back the same
// way, and the agent's next message answers it. No Claude model runs.

// Codex's files as model.ts reads them; `$.env.get` takes literal names.
async function files($: EngineInterface): Promise<Files> {
  const [CODEX_HOME, HOME, USERPROFILE] = [await $.env.get('CODEX_HOME'), await $.env.get('HOME'), await $.env.get('USERPROFILE')]
  return { env: { CODEX_HOME, HOME, USERPROFILE }, read: path => $.fs.read(path) }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const spec of specsOf(await codexModels(await files($)))) await $.agent.register(spec)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    closeHeld()
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const type = TYPES[e.subagentType]
    if (!type) return next(e)
    const flags = flagsOf(e.prompt, type.pin)
    const label = labelOf(await codexConfig(await files($)), 'error' in flags ? {} : flags)
    return next({ ...e, description: `${e.description} · ${label}` })
  })

  // The transcript's Agent row names the type in words, not `codex:read`.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const input = e.props.input as { subagent_type?: unknown } | undefined
    const type = e.props.tool === 'Agent' && typeof input?.subagent_type === 'string' ? TYPES[input.subagent_type] : undefined
    if (!type) return next(e)
    return next({ ...e, props: { ...e.props, input: { ...input, subagent_type: type.shown } } })
  })

  on('turn.step', step)
}
