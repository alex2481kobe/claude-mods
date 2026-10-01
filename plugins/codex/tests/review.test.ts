import { describe, expect, test } from 'claude-code/testing'

import { apply, type Run } from '../hooks/events'
import { nameOf } from '../hooks/names'


describe('names', () => {
  test('codex ids read as people say them', () => {
    expect(nameOf('gpt-6.1-sol')).toBe('Sol 6.1')
    expect(nameOf('gpt-6-astra')).toBe('Astra 6')
    expect(nameOf('gpt-5.5')).toBe('gpt-5.5')
  })
})

describe('events', () => {
  test('an error Codex recovers from does not fail the run', () => {
    const run: Run = {}
    apply(run, JSON.stringify({ type: 'error', message: 'reconnecting' }))
    apply(run, JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }))
    apply(run, JSON.stringify({ type: 'turn.completed', usage: {} }))
    expect(run.error).toBeUndefined()
    expect(run.answer).toBe('ok')
  })
})

describe('usage', () => {
  test('a completed turn carries Codex usage in the engine shape, cached tokens apart', () => {
    const run: Run = {}
    apply(run, JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50, reasoning_output_tokens: 0 } }))
    expect(run.usage).toEqual({ input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 })
  })
})
