import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, On, TurnStepResult } from 'claude-code'

const CHECKER = '---\nname: checker\nmodel: claude-sonnet-5-5\neffort: medium\n---\n'

// The engine beneath the plugin: an agent folder holding checker.md, a main
// loop on Opus 5.5 at high effort, and spawns that record the description
// the agent list would show.
function engine(on: On, shown: string[], env: Record<string, string> = {}) {
  mock.env(on, { HOME: '/home/me', ...env })
  on('session.root', () => ({ value: '/repo' }))
  on('fs.list', (_$, e) => ({
    value: e.path === '/home/me/.claude/agents' ? [{ name: 'checker.md', kind: 'file' as const, size: 1, mtimeMs: 0, isLink: false }] : [],
  }))
  on('fs.read', (_$, e) => ({ value: e.path === '/home/me/.claude/agents/checker.md' ? CHECKER : '' }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as unknown as TurnStepResult
  })
  on('agent.spawn', (_$, e: AgentSpawnInput) => {
    shown.push(e.description)
    return { model: e.model ?? e.parentModel, agentId: `a${shown.length}` }
  })
}

const SPAWN = { prompt: 'p', description: 'Review auth', fork: false, background: false, parentModel: 'claude-opus-5-5' }

describe('agent.spawn', () => {
  test('labels a general-purpose agent with the parent model and effort, and a user agent with its file', async ($, on) => {
    const shown: string[] = []
    engine(on, shown)
    const step = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
    for await (const _ of step);
    await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' } } as never)
    await $.agent.spawn({ ...SPAWN, subagentType: 'checker', provider: { plugin: 'user', tier: 'user' } } as never)
    await $.agent.spawn({ ...SPAWN, subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' } } as never)
    expect(shown).toEqual(['Review auth · Opus 5.5 (high)', 'Review auth · Sonnet 5.5 (medium)', 'Review auth'])
  })

  test('an empty CLAUDE_CONFIG_DIR reads the home folder', async ($, on) => {
    const shown: string[] = []
    engine(on, shown, { CLAUDE_CONFIG_DIR: '' })
    await $.agent.spawn({ ...SPAWN, subagentType: 'checker', provider: { plugin: 'user', tier: 'user' } } as never)
    expect(shown).toEqual(['Review auth · Sonnet 5.5 (medium)'])
  })
})
