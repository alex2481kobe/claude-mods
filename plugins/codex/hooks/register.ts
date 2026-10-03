import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { specsOf, TYPES } from './agents'
import { replyBand } from './band'
import { HINT, isCommand, SPECS } from './commands'
import { flagsOf } from './flags'
import { codexConfig, codexModels, labelOf, type Files } from './model'
import { closeHeld, command, steer, step } from './step'
import { openView, replyIn, setOpenView } from './view'

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

// The prompt each codex agent was spawned with, which carries its options:
// the engine may later place another message ahead of it in the agent's
// conversation, so step.ts reads the options from here.
const openings = atom({ plugin: 'codex', key: 'openings' } as const, {})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const spec of specsOf(await codexModels(await files($)))) await $.agent.register(spec)
    for (const spec of SPECS) await $.command.register(spec)
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
    // The agent keeps the stand-in's Claude model: a run the mod does not
    // answer (the mod not loaded, a resume elsewhere) is sent to it, so it
    // must be one the Anthropic API serves, never the Codex model.
    const label = labelOf(await codexConfig(await files($)), 'error' in flags ? {} : flags)
    const started = await next({ ...e, description: `${e.description} · ${label}` })
    const agentId = started.agentId
    if (agentId) await update($, openings, all => ({ ...all, [agentId]: e.prompt }))
    return started
  })

  // The transcript's Agent row names the type in words, not `codex:read`.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const input = e.props.input as { subagent_type?: unknown } | undefined
    const type = e.props.tool === 'Agent' && typeof input?.subagent_type === 'string' ? TYPES[input.subagent_type] : undefined
    if (!type) return next(e)
    return next({ ...e, props: { ...e.props, input: { ...input, subagent_type: type.shown } } })
  })

  on('turn.step', step)

  // A message sent to a codex agent while Codex works joins Codex's running
  // turn, so Codex reads it now and its answer covers it; the agent is not
  // also sent it, which would start another Codex turn once this one ends.
  on('session.send', async ($, e, next) => {
    const agent = (await $.agent.list()).find(a => a.id === e.to || a.name === e.to)
    if (!agent || !TYPES[agent.type] || isCommand(e.text)) return next(e)
    return (await steer(agent.id, e.text)) ? { isDelivered: true } : next(e)
  })

  // The codex agent whose view is open: the band above the prompt is drawn
  // for the view on screen, and shows the reply to the last /codex- command
  // run there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const id = e.props.view.agentId
    const agent = id === undefined ? undefined : (await $.agent.list()).find(a => a.id === id)
    if (setOpenView(agent && TYPES[agent.type] ? id : undefined)) {
      $.ui.invalidate('ui.render')
      $.ui.invalidate('command.describe')
    }
    const view = openView()
    const reply = view === undefined ? undefined : replyIn(view)
    return reply ? replyBand($.ui.resolve(e), reply, await next(e)) : next(e)
  })

  // There the footer names the agent's commands, and the "/" menu lists them
  // alone: Claude Code's act on the main session rather than the agent.
  // Elsewhere the agent's commands are left out.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => (openView() ? next({ ...e, props: { ...e.props, tail: HINT } }) : next(e)))
  on('command.describe', async ($, e, next) => (Boolean(openView()) !== isCommand(`/${e.command}`) ? next({ ...e, isHidden: true }) : next(e)))
  on('command.run', command)
}
