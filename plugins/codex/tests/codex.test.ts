import { describe, expect, test } from 'claude-code/testing'

import { apply, lines, type Run } from '../hooks/events'

const SESSION = '01a0f8f0-0000-7000-8000-000000000000'

// Shapes as `codex exec --json` (codex-cli 0.159) prints them.
const EVENTS = [
  { type: 'thread.started', thread_id: SESSION },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'Reading go.mod.\n' } },
  { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "zsh -lc 'cat go.mod'", exit_code: null } },
  { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "zsh -lc 'cat go.mod'", exit_code: 0 } },
  { type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text: 'example.com/m go 1.26' } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
].map(e => JSON.stringify(e))

describe('events', () => {
  test('lines keeps a line split across chunks whole', () => {
    const a = lines('', '{"a":1}\n{"b"')
    expect(a.done).toEqual(['{"a":1}'])
    const b = lines(a.rest, ':2}\n')
    expect(b.done).toEqual(['{"b":2}'])
    expect(b.rest).toBe('')
  })

  test('a run yields the session, commands and messages, and answers with the last message', () => {
    const run: Run = {}
    const shown = EVENTS.map(line => apply(run, line)).filter(Boolean).join('')
    expect(run.sessionId).toBe(SESSION)
    expect(run.answer).toBe('example.com/m go 1.26')
    expect(shown).toContain(`codex session ${SESSION}`)
    expect(shown).toContain('$ cat go.mod')
    expect(shown).not.toContain('exit 0')
  })

  test('a failed turn records the error', () => {
    const run: Run = {}
    apply(run, JSON.stringify({ type: 'turn.failed', error: { message: 'quota' } }))
    expect(run.error).toBe('quota')
  })
})
