import { describe, expect, mock, test } from 'claude-code/testing'

import { specsOf } from '../hooks/agents'

// Codex's files where the mod looks for them, from the environment.
const FILES: Record<string, string> = {
  '/home/me/.codex/config.toml': 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "xhigh"\n',
  '/home/me/.codex/models_cache.json': '{"models":[{"slug":"gpt-6.1-sol"},{"slug":"gpt-6-astra"}]}',
}

describe('agent types', () => {
  test('the session registers the three types, offering the models Codex knows', async ($, on) => {
    mock.env(on, { HOME: '/home/me' })
    on('fs.read', (_$, e) => ({ value: FILES[e.path] ?? '' }))
    const registered: { name: string; description: string }[] = []
    on('agent.register', (_$, e) => {
      registered.push(e)
      return { value: { agent: `codex:${e.name}` } }
    })
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true } as never)
    expect(registered.map(r => r.name)).toEqual(['read', 'write', 'run'])
    for (const r of registered) expect(r.description).toContain('models: gpt-6.1-sol, gpt-6-astra')
  })

  test('with no Codex model cache (a fresh install) the descriptions name no models and still read whole', () => {
    for (const { description } of specsOf([])) {
      expect(description).not.toContain('models:')
      expect(description).toContain('(`model: <id>`, `effort: <level>`); left out, Codex uses its own config.')
    }
  })

  test('a spawned agent is labelled with the model and effort it will run on', async ($, on) => {
    mock.env(on, { HOME: '/home/me' })
    on('fs.read', (_$, e) => ({ value: FILES[e.path] ?? '' }))
    let description = ''
    on('agent.spawn', (_$, e) => {
      description = e.description
      return { model: 'haiku' }
    })
    await $.agent.spawn({ subagentType: 'codex:read', prompt: 'model: gpt-6-astra\nReview app.js', description: 'Review' } as never)
    expect(description).toBe('Review · Astra 6 (xhigh)')
  })

  test('a spawned agent names the Codex model it runs on, so the task list shows it', async ($, on) => {
    mock.env(on, { HOME: '/home/me' })
    on('fs.read', (_$, e) => ({ value: FILES[e.path] ?? '' }))
    const models: (string | undefined)[] = []
    on('agent.spawn', (_$, e) => (models.push(e.model), { model: e.model ?? 'haiku' }))
    await $.agent.spawn({ subagentType: 'codex:read', prompt: 'model: gpt-6-astra\nReview app.js', description: 'Review' } as never)
    await $.agent.spawn({ subagentType: 'codex:read', prompt: 'Review app.js', description: 'Review' } as never)
    expect(models).toEqual(['gpt-6-astra', 'gpt-6.1-sol'])
  })

  test('if the mod fails on a step, the stand-in runs on a Claude model, not the Codex one', async ($, on) => {
    on('agent.list', () => ({ value: [{ id: 'a1', type: 'codex:read', description: 'Review', status: 'running' }, { id: 'g1', type: 'general-purpose', description: 'Search', status: 'running' }] }))
    on('session.messages', () => ({ value: { deny: 'not readable' } as never }))
    const models: string[] = []
    on('turn.step', async function* (_$, e) {
      models.push(e.model)
      yield { kind: 'stop', stopReason: 'end_turn', usage: null }
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    for (const agentId of ['a1', 'g1']) {
      const stream = $.turn.step({ turnId: 't', index: 0, model: 'gpt-6-astra', messageCount: 1, agentId })
      for (let next = await stream.next(); !next.done; next = await stream.next());
    }
    // Another agent's failed step keeps its own model.
    expect(models).toEqual(['claude-haiku-4-5', 'gpt-6-astra'])
  })

  // The agent list summarises a running agent from its definition's prompt,
  // which only a stand-in model would read: it must read as what the agent
  // does, and still make a stand-in report that Codex did not run.
  test('the stand-in prompt reads as relaying to Codex, and a stand-in reports that Codex did not run', () => {
    for (const { prompt } of specsOf([])) {
      const opening = prompt.split(/(?<=[.:])\s/)[0]!
      expect(opening).toMatch(/Codex/)
      expect(opening).not.toMatch(/fail|did not|error|stand/i)
      expect(prompt).not.toMatch(/failed to start/)
      expect(prompt).toMatch(/report[^.]*Codex did not run/i)
    }
  })
})
