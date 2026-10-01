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
    apply(run, 'error', { error: { message: 'reconnecting' }, willRetry: true })
    apply(run, 'item/completed', { item: { type: 'agentMessage', text: 'ok' } })
    apply(run, 'turn/completed', { turn: { status: 'completed' } })
    expect(run.error).toBeUndefined()
    expect(run.answer).toBe('ok')
  })
})

describe('usage', () => {
  test('a turn carries what it added to the thread, in the engine shape, cached tokens apart', () => {
    const run: Run = {}
    // A resumed thread already held 5000 tokens; this turn made two requests.
    const at = (input: number, cached: number, output: number) => ({ inputTokens: input, cachedInputTokens: cached, outputTokens: output })
    apply(run, 'thread/tokenUsage/updated', { tokenUsage: { total: at(5600, 800, 60), last: at(600, 300, 10) } })
    apply(run, 'thread/tokenUsage/updated', { tokenUsage: { total: at(6000, 1300, 100), last: at(400, 500, 40) } })
    expect(run.usage).toEqual({ input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 })
  })
})
