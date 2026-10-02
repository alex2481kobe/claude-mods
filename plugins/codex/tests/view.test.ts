import { describe, expect, test } from 'claude-code/testing'
import type { AgentInfo, CommandDescribeInput, On } from 'claude-code'

import { HINT } from '../hooks/commands'

const AGENTS: AgentInfo[] = [
  { id: 'c1', type: 'codex:read', description: 'Review', status: 'completed' },
  { id: 'g1', type: 'general-purpose', description: 'Search', status: 'running' },
]
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 10 } }
const STATUS: CommandDescribeInput = { command: 'status', description: 'Show status', isHidden: false, immediate: false, provider: { plugin: 'engine', tier: 'core' } }

// What the engine beneath the plugin is handed: the footer's tail and each
// command's hidden flag.
function beneath(on: On): { tail: () => string | undefined } {
  let tail: string | undefined
  on('agent.list', () => ({ value: AGENTS }))
  on('ui.render', { component: 'PromptHint' }, (_$, e) => {
    tail = e.props.tail
    return { type: 'Text', props: {}, children: [e.props.hint] } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('command.describe', (_$, e) => ({ description: e.description, isHidden: e.isHidden }))
  return { tail: () => tail }
}

describe('a codex agent\'s view', () => {
  test('names the commands in the footer and hides the others from the menu while it is open, and only then', async ($, on) => {
    const seen = beneath(on)
    const band = await $.ui.mount({ plugin: 'codex', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, view: {} } })
    const hint = await $.ui.mount({ plugin: 'codex', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } })
    expect(seen.tail()).toBeUndefined()
    expect((await $.command.describe(STATUS)).isHidden).toBe(false)

    // The band sees the switch; the footer follows the plugin's redraw.
    await band.redraw({ ...BAND, view: { agentId: 'c1' } })
    await hint.find({ type: 'Text' })
    expect(seen.tail()).toBe(HINT)
    expect((await $.command.describe(STATUS)).isHidden).toBe(true)

    await band.redraw({ ...BAND, view: { agentId: 'g1' } })
    await hint.find({ type: 'Text' })
    expect(seen.tail()).toBeUndefined()
    expect((await $.command.describe(STATUS)).isHidden).toBe(false)
  })
})
