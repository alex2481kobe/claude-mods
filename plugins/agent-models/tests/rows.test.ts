import { describe, expect, test } from 'claude-code/testing'

import { lineOf, nameOf, shown, upsert } from '../hooks/rows'

describe('rows', () => {
  test('a spawn adds a row and a step fills in its model and effort', () => {
    let rows = upsert([], 'a1', { type: 'general-purpose', label: 'Review auth', status: 'running' })
    rows = upsert(rows, 'a1', { model: 'claude-opus-5-5', effort: 'high' })
    expect(lineOf(rows[0]!)).toEqual({
      mark: '●',
      type: 'general-purpose',
      model: 'Opus 5.5 (high)',
      label: 'Review auth',
      isRunning: true,
    })
  })

  test('a step for an agent never spawned here adds nothing', () => {
    expect(upsert([], 'x', { model: 'm' })).toEqual([])
  })

  test('a codex agent shows the model its label names, not its stand-in model', () => {
    const row = { id: 'c', type: 'codex:read', label: 'Review app.js · codex gpt-6-astra (high)', model: 'claude-haiku-4-5', status: 'done' as const }
    expect(lineOf(row)).toMatchObject({ model: 'gpt-6-astra (high)', label: 'Review app.js', mark: '✓' })
  })

  test('running rows come first and the list fits the room', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, type: 't', label: id, status: i === 0 ? ('running' as const) : ('done' as const) }))
    expect(shown(rows, 2).map(r => r.id)).toEqual(['a', 'd'])
  })

  test('claude ids read as people say them', () => {
    expect(nameOf('claude-opus-5-5')).toBe('Opus 5.5')
    expect(nameOf('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(nameOf('some-other-model')).toBe('some-other-model')
  })
})
