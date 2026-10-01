import { describe, expect, test } from 'claude-code/testing'

import { HANDBACK, handsBack, lastReport, requestOf, rowsOf, type ApiTurn } from '../hooks/request'

// Shapes as an agent's conversation holds them in API form.
const SESSION = '01a0f92d-0000-7000-8000-000000000000'
const TASK = 'model: gpt-6-astra\nList the functions.'
const QUEUED = 'The coordinator sent a message while you were working:\nAlso count the lines.\n\nAddress this before completing your current task.'
const REMINDER = `<system-reminder>\nYour final report is delivered through ${HANDBACK}: call ${HANDBACK}({message: <your full report>}).\n</system-reminder>`

const user = (...texts: string[]): ApiTurn => ({ role: 'user', content: texts.map(text => ({ type: 'text', text })) })
const ran = (handback = true): ApiTurn => ({
  role: 'assistant',
  content: [
    { type: 'text', text: `codex Astra 6 (xhigh) · read-only\ncodex session ${SESSION}\n\nthe list\n` },
    ...(handback ? [{ type: 'tool_use', id: 'h1', name: HANDBACK, input: { message: 'the list' } }] : []),
  ],
})
const delivered = (isError = false, ...texts: string[]): ApiTurn => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 'h1', content: 'Report delivered', is_error: isError }, ...texts.map(text => ({ type: 'text', text }))],
})

describe('requests', () => {
  test('the first run is the spawn prompt alone, without the engine reminder', () => {
    expect(requestOf(rowsOf([user(TASK, REMINDER)]), [])).toEqual({ prompt: TASK, opening: TASK, texts: [TASK], sessionId: undefined })
  })

  test('nothing new after a run is no request', () => {
    expect(requestOf(rowsOf([user(TASK, REMINDER), ran(), delivered()]), [TASK])).toBeUndefined()
  })

  test('a queued message the engine folded into the first turn is the next request, resuming the session', () => {
    const rows = rowsOf([user(TASK, QUEUED, REMINDER), ran(), delivered()])
    expect(requestOf(rows, [TASK])).toEqual({ prompt: 'Also count the lines.', opening: TASK, texts: [QUEUED], sessionId: SESSION })
  })

  test('a queued message delivered with the handback result is the next request', () => {
    expect(requestOf(rowsOf([user(TASK, REMINDER), ran(), delivered(false, QUEUED)]), [TASK])).toMatchObject({ prompt: 'Also count the lines.', sessionId: SESSION })
  })

  test('a message the engine placed twice, wrapped and as sent, reaches Codex once', () => {
    // As a live headless run placed one SendMessage.
    const wrapped = 'The coordinator sent a message while you were working:\ndecline\n\nAddress this before completing your current task.\n'
    const request = requestOf(rowsOf([user(TASK), ran(false), user(wrapped, 'decline')]), [TASK])
    expect(request).toMatchObject({ prompt: 'decline', texts: [wrapped, 'decline'] })
  })

  test('an engine nudge is no request', () => {
    expect(requestOf(rowsOf([user(TASK), ran(), delivered(false, '[handback-send-enforce] Your report has not been delivered.')]), [TASK])).toBeUndefined()
  })

  test('a run stopped part way resumes its session on the next message', () => {
    expect(requestOf(rowsOf([user(TASK), ran(false), user('continue')]), [TASK])).toMatchObject({ prompt: 'continue', sessionId: SESSION })
  })

  test('a text report naming its session lets a follow-up resume it (headless)', () => {
    const answered: ApiTurn = { role: 'assistant', content: [{ type: 'text', text: `the list\n\ncodex session ${SESSION}` }] }
    expect(requestOf(rowsOf([user(TASK), answered, user('and y?')]), [TASK])).toMatchObject({ prompt: 'and y?', sessionId: SESSION })
  })

  test('the same words sent again are asked again', () => {
    expect(requestOf(rowsOf([user(TASK), ran(false), user('go'), user('go')]), [TASK, 'go'])).toMatchObject({ texts: ['go'] })
  })
})

describe('reporting', () => {
  test('a loop hands back until a handback fails for want of the tool', () => {
    expect(handsBack(rowsOf([user(TASK, REMINDER), ran(), delivered()]))).toBe(true)
    expect(handsBack(rowsOf([user(TASK), ran(), delivered(true)]))).toBe(false)
  })

  test('the failed handback\'s report is kept to send as text', () => {
    expect(lastReport(rowsOf([user(TASK), ran(), delivered(true)]))).toBe('the list')
  })
})
