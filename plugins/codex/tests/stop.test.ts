import { describe, expect, test } from 'claude-code/testing'

import { answerOf } from '../hooks/events'
import { HANDBACK, type ApiTurn } from '../hooks/request'
import { codex, engine, INTERIM, REMINDER, step, TASK } from './fake'

const STOPPED = 'codex: stopped before Codex finished.'

// A message typed in the agent's view, as the engine wraps it.
const typed = (text: string) =>
  `The user sent a new message while you were working:\n${text}\n\nThis is how Claude Code surfaces messages the user sends mid-turn — within the running turn, often alongside the next tool result, rather than as a separate conversation turn. Address the message above as you continue this turn.`

const INTERRUPTED = "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."

describe('a codex agent stopped', () => {
  // The test kit cannot abort a hook's signal, as Esc does, so the answer a
  // stopped run gives is checked where it is made.
  test('before Codex finished answers with the stopped line, none of what Codex said on the way', () => {
    expect(answerOf({ answer: INTERIM })).toBe(STOPPED)
    expect(answerOf({})).toBe(STOPPED)
    expect(answerOf({ answer: 'Done.', isDone: true })).toBe('Done.')
    expect(answerOf({ isDone: true })).toBe('codex: the turn ended without a message.')
    expect(answerOf({ answer: INTERIM, isDone: true, error: 'boom' })).toBe(`${INTERIM}\n\ncodex failed: boom`)
  })

  test('hands back a stopped line that never goes ahead of a later answer', async ($, on) => {
    const turns: ApiTurn[] = [{ role: 'user', content: [{ type: 'text', text: TASK }, { type: 'text', text: REMINDER }] }]
    engine(on, turns)
    codex(on, 'quiet')
    const done = await step($, 0)
    // The stopped step's handback, interrupted, then a new message.
    turns.push(
      { role: 'assistant', content: [{ type: 'text', text: done.text }, { type: 'tool_use', id: 'h1', name: HANDBACK, input: { message: STOPPED } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'h1', content: INTERRUPTED }, { type: 'text', text: typed('Count again.') }] },
    )
    expect((await step($, 1)).report).toBe('Counted.')
  })
})
