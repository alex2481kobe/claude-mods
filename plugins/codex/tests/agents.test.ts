import { describe, expect, mock, test } from 'claude-code/testing'

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
})
