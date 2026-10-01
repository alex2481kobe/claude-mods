import { describe, expect, test } from 'claude-code/testing'

import { HANDBACK, handsBack, requestOf, rowsOf, type ApiTurn } from '../hooks/request'

// Shapes as an interactive session's agent conversation holds them.
const SESSION = '01a0f92d-0000-7000-8000-000000000000'
const REMINDER = `<system-reminder>\nYour final report is delivered through ${HANDBACK}: call ${HANDBACK}({message: <your full report>}).\n</system-reminder>`
const opening: ApiTurn = { role: 'user', content: [{ type: 'text', text: 'model: gpt-6-astra\nList the functions.' }, { type: 'text', text: REMINDER }] }
const ran: ApiTurn = {
  role: 'assistant',
  content: [
    { type: 'text', text: `codex Astra 6 (xhigh) · read-only\ncodex session ${SESSION}\n\nthe list\n` },
    { type: 'tool_use', id: 'h1', name: HANDBACK, input: { message: 'the list' } },
  ],
}
const delivered = (extra: string[] = [], isError = false): ApiTurn => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 'h1', content: 'Report delivered', is_error: isError }, ...extra.map(text => ({ type: 'text', text }))],
})

describe('conversation', () => {
  test('the first run is the spawn prompt alone, without the engine reminder', () => {
    expect(requestOf(rowsOf([opening]))).toEqual({ prompt: 'model: gpt-6-astra\nList the functions.', opening: 'model: gpt-6-astra\nList the functions.' })
  })

  test('a message queued while Codex ran is the next request, resuming the session', () => {
    const queued = 'The coordinator sent a message while you were working:\nAlso count the lines.\n\nAddress this before completing your current task.'
    expect(requestOf(rowsOf([opening, ran, delivered([queued])]))).toMatchObject({ prompt: queued, sessionId: SESSION })
  })

  test('an engine nudge after the handback is no request', () => {
    expect(requestOf(rowsOf([opening, ran, delivered(['[handback-send-enforce] Your report has not been delivered.'])]))).toBeUndefined()
  })

  test('a failed handback is marked from its tool result', () => {
    expect(handsBack(rowsOf([opening, ran, delivered([], true)]))).toBe(false)
    expect(handsBack(rowsOf([opening, ran, delivered()]))).toBe(true)
  })
})
