import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'

import { HANDBACK, type ApiTurn } from '../hooks/request'
import { QUIET_LINE } from '../hooks/quiet'
import { codex, REMINDER, step, TASK } from './fake'

// A message typed in the agent's view, as the engine wraps it.
const typed = (text: string) =>
  `The user sent a new message while you were working:\n${text}\n\nThis is how Claude Code surfaces messages the user sends mid-turn — within the running turn, often alongside the next tool result, rather than as a separate conversation turn. Address the message above as you continue this turn.`
// The rows the main conversation gets for a subagent's run, as delivered.
const report = (agentId: string, text: string) =>
  `Another Claude session sent a message:\n<agent-message from="${agentId}">\n[Subagent hand-back] The report follows:\n  ${text}\n</agent-message>\n\nThat "other Claude session" is an agent working inside this same session.`
const finished = (agentId: string) =>
  `<task-notification>\n<task-id>${agentId}</task-id>\n<status>completed</status>\n<summary>Agent "Count" finished</summary>\n</task-notification>`
const user = (...texts: string[]): ApiTurn => ({ role: 'user', content: texts.map(text => ({ type: 'text', text })) })
const said = (text: string): ApiTurn => ({ role: 'assistant', content: [{ type: 'text', text }] })

// One codex agent and the main conversation, each with its own messages; the
// test's turn.step stands for the model and counts the main loop's calls.
function session(on: On, agentTurns: ApiTurn[], mainTurns: ApiTurn[]): { modelCalls: () => number } {
  mock.env(on, { HOME: '/home/me' })
  const agent: AgentInfo = { id: 'a1', type: 'codex:run', description: 'Count', status: 'running' }
  on('agent.list', () => ({ value: [agent] }))
  on('session.messages', (_$, e) => ({ value: (e?.agentId ? agentTurns : mainTurns) as never }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.read', () => ({ value: '' }))
  let calls = 0
  on('turn.step', async function* (_$, e) {
    calls++
    yield { kind: 'text', index: 0, text: 'Claude replies.' }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: 'Claude replies.', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return { modelCalls: () => calls }
}

async function mainStep($: any): Promise<string> {
  const stream = $.turn.step({ turnId: 'm', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  let next = await stream.next()
  while (!next.done) next = await stream.next()
  return next.value.answer
}

// The agent's first run (the spawn prompt), its report delivered, then a
// message the user typed in its view and that run.
async function runs($: any, agentTurns: ApiTurn[], viewTyped: boolean): Promise<void> {
  const first = await step($, 0)
  agentTurns.push(
    { role: 'assistant', content: [{ type: 'text', text: first.text }, { type: 'tool_use', id: 'h1', name: HANDBACK, input: { message: first.report } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'h1', content: 'Report delivered' }, { type: 'text', text: viewTyped ? typed('Count again.') : 'The coordinator sent a message while you were working:\nCount again.\n\nAddress this before completing your current task.' }] },
  )
  await step($, 1)
}

describe('the main conversation and a codex agent\'s reports', () => {
  test('a report answering what the user typed in the agent\'s view gets no model turn in main, and stays in its history', async ($, on) => {
    const agentTurns: ApiTurn[] = [user(TASK, REMINDER)]
    const mainTurns: ApiTurn[] = [user('Count the lines with codex.'), said('Started.')]
    const seen = session(on, agentTurns, mainTurns)
    codex(on, 'quiet')
    await runs($, agentTurns, true)

    // Opening the view with /tasks leaves its command rows, which ask nothing.
    mainTurns.push(user('<command-name>/tasks</command-name>\n            <command-message>tasks</command-message>\n            <command-args></command-args>'), user('<local-command-stdout>Viewing agent</local-command-stdout>'), user(report('a1', 'Counted.')))
    // One visible line: Claude Code asks the model again after an empty answer.
    expect(await mainStep($)).toBe(QUIET_LINE)
    mainTurns.push(said(QUIET_LINE), user(finished('a1'), REMINDER))
    expect(await mainStep($)).toBe(QUIET_LINE)
    expect(seen.modelCalls()).toBe(0)
  })

  test('a report for a task Claude asked for gets the model\'s turn', async ($, on) => {
    const agentTurns: ApiTurn[] = [user(TASK, REMINDER)]
    const mainTurns: ApiTurn[] = [user('Count the lines with codex.'), said('Started.')]
    const seen = session(on, agentTurns, mainTurns)
    codex(on, 'quiet')
    await runs($, agentTurns, false)

    mainTurns.push(user(report('a1', 'Counted.')))
    expect(await mainStep($)).toBe('Claude replies.')
    expect(seen.modelCalls()).toBe(1)
  })

  test('anything else new beside the report gets the model\'s turn', async ($, on) => {
    const agentTurns: ApiTurn[] = [user(TASK, REMINDER)]
    const mainTurns: ApiTurn[] = [user('Count the lines with codex.'), said('Started.')]
    const seen = session(on, agentTurns, mainTurns)
    codex(on, 'quiet')
    await runs($, agentTurns, true)

    mainTurns.push(user(report('a1', 'Counted.')), user('And what did Codex say?'))
    expect(await mainStep($)).toBe('Claude replies.')
    mainTurns.push(said('It said Counted.'), user(report('b9', 'Elsewhere.')))
    expect(await mainStep($)).toBe('Claude replies.')
    // A slash command that prompts the model arrives as command rows alone.
    mainTurns.push(said('Noted.'), user('<command-name>/review</command-name>\n<command-message>review</command-message>\n<command-args></command-args>'))
    expect(await mainStep($)).toBe('Claude replies.')
    expect(seen.modelCalls()).toBe(3)
  })
})
