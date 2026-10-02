import { describe, expect, test } from 'claude-code/testing'

import { HANDBACK, type ApiTurn } from '../hooks/request'
import { codex, engine, REMINDER, step, TASK, THREAD } from './fake'

// A message typed in the agent's view, as the engine wraps it.
const typed = (text: string) =>
  `The user sent a new message while you were working:\n${text}\n\nThis is how Claude Code surfaces messages the user sends mid-turn — within the running turn, often alongside the next tool result, rather than as a separate conversation turn. Address the message above as you continue this turn.`

// The agent's last turn handed back, and the next message the user typed.
function reply(turns: ApiTurn[], done: { text: string; report: string }, text: string, id: string): void {
  turns.push(
    { role: 'assistant', content: [{ type: 'text', text: done.text }, { type: 'tool_use', id, name: HANDBACK, input: { message: done.report } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'Report delivered to your caller.' }, { type: 'text', text: typed(text) }] },
  )
}

describe('commands in a codex agent', () => {
  test('a command is answered as the agent\'s reply without starting Codex, and a setting holds from the next Codex turn', async ($, on) => {
    const turns: ApiTurn[] = [{ role: 'user', content: [{ type: 'text', text: TASK }, { type: 'text', text: REMINDER }] }]
    engine(on, turns)
    const fake = codex(on, 'quiet')
    let done = await step($, 0)
    expect(done.report).toBe('Counted.')

    fake.argv = []
    reply(turns, done, '/codex-model gpt-6-astra', 'h1')
    done = await step($, 1)
    expect(fake.argv).toEqual([])
    expect(done.report).toBe('codex: model gpt-6-astra from the next Codex turn.')
    expect(done.text).toContain('gpt-6-astra from the next Codex turn')

    reply(turns, done, '/codex-sandbox read-only', 'h2a')
    done = await step($, 21)
    reply(turns, done, '/codex-approvals never', 'h2b')
    done = await step($, 22)
    reply(turns, done, '/codex-status', 'h2')
    done = await step($, 2)
    expect(fake.argv).toEqual([])
    expect(done.report).toContain('gpt-6-astra from the next Codex turn (now gpt-6-luna)')
    expect(done.report).toContain('workspace-write')
    expect(done.report).toContain(THREAD)
    expect(done.report).toContain('1,500 in (1,000 cached), 40 out')

    reply(turns, done, 'Count the lines.', 'h3')
    done = await step($, 3)
    // A resumed session keeps the model it started with unless the resume
    // names another, so the setting goes with the resume.
    expect(fake.threads.at(-1)).toMatchObject({ threadId: THREAD, model: 'gpt-6-astra' })
    expect(done.text).toMatch(/^codex Astra 6 · Codex/)
    expect(fake.threads.at(-1)).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'never' })
    expect(done.report).toBe('Counted.')
  })

  test('a command and a message sent together: the command is answered and the message goes to Codex alone', async ($, on) => {
    const turns: ApiTurn[] = [{ role: 'user', content: [{ type: 'text', text: TASK }, { type: 'text', text: REMINDER }] }]
    engine(on, turns)
    const fake = codex(on, 'quiet')
    const done = await step($, 0)
    reply(turns, done, '/codex-effort high', 'h1')
    turns.at(-1)!.content = [...turns.at(-1)!.content, { type: 'text', text: typed('Count the lines.') }]
    fake.argv = []
    const both = await step($, 1)
    expect(both.report).toBe('codex: effort high from the next Codex turn.\n\nCounted.')
    expect(fake.threads.at(-1)).toMatchObject({ config: { model_reasoning_effort: 'high' } })
    expect(fake.prompts.at(-1)).toBe('Count the lines.')
  })

  test('a step with nothing new to pass on starts no Codex and does not hand back the last report again', async ($, on) => {
    const turns: ApiTurn[] = [{ role: 'user', content: [{ type: 'text', text: TASK }, { type: 'text', text: REMINDER }] }]
    engine(on, turns)
    const fake = codex(on, 'quiet')
    const done = await step($, 0)
    expect(done.report).toBe('Counted.')
    turns.push(
      { role: 'assistant', content: [{ type: 'text', text: done.text }, { type: 'tool_use', id: 'h1', name: HANDBACK, input: { message: done.report } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'h1', content: 'Report delivered to your caller.' }] },
    )
    fake.argv = []
    const again = await step($, 1)
    expect(fake.argv).toEqual([])
    expect(again.report).not.toContain('Counted.')
    expect(again.report).toMatch(/^codex: /)
  })

  test('where a handback failed for want of the tool, the last report is given again as text', async ($, on) => {
    const turns: ApiTurn[] = [{ role: 'user', content: [{ type: 'text', text: TASK }] }]
    engine(on, turns)
    const fake = codex(on, 'quiet')
    const done = await step($, 0)
    turns.push(
      { role: 'assistant', content: [{ type: 'text', text: done.text }, { type: 'tool_use', id: 'h1', name: HANDBACK, input: { message: done.report } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'h1', content: `<tool_use_error>Error: No such tool available: ${HANDBACK}</tool_use_error>`, is_error: true }] },
    )
    fake.argv = []
    const again = await step($, 1)
    expect(fake.argv).toEqual([])
    expect(again.report).toBe('Counted.')
  })

  test('after the person interrupts a handback, the next run still reports through the handback tool', async ($, on) => {
    const turns: ApiTurn[] = [{ role: 'user', content: [{ type: 'text', text: TASK }, { type: 'text', text: REMINDER }] }]
    engine(on, turns)
    codex(on, 'quiet')
    const done = await step($, 0)
    turns.push(
      { role: 'assistant', content: [{ type: 'text', text: done.text }, { type: 'tool_use', id: 'h1', name: HANDBACK, input: { message: done.report } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'h1', content: "The user doesn't want to proceed with this tool use. The tool use was rejected.", is_error: true } as never, { type: 'text', text: '[Request interrupted by user]' }] },
      { role: 'user', content: [{ type: 'text', text: typed('Count again.') }] },
    )
    const stream = $.turn.step({ turnId: 't', index: 1, model: 'claude-haiku-4-5', messageCount: 1, agentId: 'a1' })
    let next = await stream.next()
    while (!next.done) next = await stream.next()
    expect(next.value.toolUses.map((u: { name: string }) => u.name)).toEqual([HANDBACK])
  })
})
