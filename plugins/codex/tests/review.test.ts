import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { apply, type Run } from '../hooks/events'
import { nameOf } from '../hooks/names'
import { requestOf } from '../hooks/request'

const SESSION = '01a0f8f0-0000-7000-8000-000000000000'
const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })

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

describe('requestOf', () => {
  test('a run stopped part way resumes its session on the next message', () => {
    const stopped: SessionMessage = { role: 'assistant', text: `codex Sol 6.1 · workspace-write\ncodex session ${SESSION}\n\n$ npm test\n`, toolUses: [] }
    expect(requestOf([user('fix x'), stopped, user('continue')])).toEqual({ prompt: 'continue', opening: 'fix x', sessionId: SESSION })
  })
})
