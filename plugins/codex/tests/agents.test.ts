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
