import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { HANDBACK, handsBack, lastReport, requestOf } from '../hooks/request'

const SESSION = '01a0f8f0-0000-7000-8000-000000000000'
const user = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const reminder = user(`<system-reminder>\nCall ${HANDBACK}({message: <your full report>}) when done.</system-reminder>`)
const handedBack = (isError?: true): SessionMessage => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool_use_id: 't', tool: HANDBACK, input: { message: 'the report' }, ...(isError ? { isError } : {}) }],
})

describe('reporting', () => {
  test('a loop hands back by default, whether or not a reminder is visible', () => {
    expect(handsBack([user('task'), reminder])).toBe(true)
    expect(handsBack([user('task')])).toBe(true)
  })

  test('a handback that failed for want of the tool switches to text and keeps the report', () => {
    const rows = [user('task'), reminder, handedBack(true), user('')]
    expect(handsBack(rows)).toBe(false)
    expect(requestOf(rows)).toBeUndefined()
    expect(lastReport(rows)).toBe('the report')
  })

  test('a text report naming its session lets a follow-up resume it', () => {
    const answered: SessionMessage = { role: 'assistant', text: `the report\n\ncodex session ${SESSION}`, toolUses: [] }
    expect(requestOf([user('task'), answered, user('and y?')])).toEqual({ prompt: 'and y?', opening: 'task', sessionId: SESSION })
  })
})

describe('queued messages', () => {
  test('a message queued while Codex ran, delivered with the handback result, is the next request', () => {
    const queued: SessionMessage = {
      role: 'user',
      text: 'The coordinator sent a message while you were working:\nAlso count the lines in app.js.\n\nAddress this before completing your current task.',
      toolUses: [],
      toolResults: [{ tool_use_id: 't', text: 'delivered', isError: false, result: {} }] as never,
    }
    const answered: SessionMessage = { role: 'assistant', text: `codex session ${SESSION}\n\nthe report\n`, toolUses: [] }
    expect(requestOf([user('task'), answered, queued])).toMatchObject({ prompt: queued.text, sessionId: SESSION })
  })
})
