import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, TurnStepChunk } from 'claude-code'

import { HANDBACK, type ApiTurn } from '../hooks/request'

// The test runner has timers; the mod's own environment declares none.
declare const setTimeout: (run: () => void, ms: number) => unknown

const FIFO = '/tmp/codex-mod.test/in'
const TASK = 'model: gpt-6-luna\nsandbox: read-only\nask-for-approval: on-request\nconfig: approvals_reviewer="user"\nCreate note.txt.'
const REMINDER = `<system-reminder>\nYour final report is delivered through ${HANDBACK}.\n</system-reminder>`

type Fake = { argv: string[]; decisions: unknown[]; isClosed: boolean }

// A stand-in for `codex app-server` behind the mod's shell: it reads the
// mod's JSON-RPC from the FIFO, answers it on stdout, asks for one approval
// in its turn, and finishes the turn once that is answered.
function codex(on: On, missing = false): Fake {
  const fake: Fake = { argv: [], decisions: [], isClosed: false }
  const out: string[] = []
  let wake: (() => void) | undefined
  const send = (message: object) => {
    out.push(JSON.stringify(message))
    wake?.()
  }
  on('process.spawn', async function* (_$, e) {
    fake.argv = [...e.argv]
    yield { stream: 'stdout' as const, text: `{"fifo":"${FIFO}"}\n` }
    if (missing) {
      yield { stream: 'stderr' as const, text: "error: unrecognized subcommand 'app-server'\n" }
      fake.isClosed = true
      return { value: { code: 2, signal: null } }
    }
    try {
      for (;;) {
        // Idle, it still yields now and then, so a close reaches it as it
        // reaches a real child.
        if (out.length === 0) await new Promise<void>(resolve => ((wake = resolve), setTimeout(resolve, 5)))
        yield { stream: 'stdout' as const, text: out.length > 0 ? `${out.shift()}\n` : '' }
      }
    } finally {
      fake.isClosed = true
    }
    return { value: { code: 0, signal: null } }
  })
  on('fs.write', (_$, e) => {
    if (e.path !== FIFO) return { value: undefined }
    for (const line of e.text.split('\n').filter(Boolean)) {
      const m = JSON.parse(line)
      if (m.method === 'initialize') send({ id: m.id, result: {} })
      if (m.method === 'thread/start' || m.method === 'thread/resume') send({ id: m.id, result: { thread: { id: 'th1' } } })
      if (m.method === 'turn/start') {
        send({ id: m.id, result: { turn: { id: 't1' } } })
        send({ id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 'th1', command: "/bin/zsh -lc 'printf hi > note.txt'", cwd: '/work' } })
      }
      if (m.method === undefined && m.id === 0) {
        fake.decisions.push(m.result?.decision)
        send({ method: 'item/completed', params: { threadId: 'th1', item: { type: 'agentMessage', text: 'Created note.txt.' } } })
        send({ method: 'turn/completed', params: { threadId: 'th1', turn: { status: 'completed' } } })
      }
    }
    return { value: undefined }
  })
  return fake
}

// The rest of the engine one codex agent's step reads.
function engine(on: On, turns: ApiTurn[]) {
  mock.env(on, { HOME: '/home/me' })
  const agent: AgentInfo = { id: 'a1', type: 'codex:run', description: 'Write note', status: 'running' }
  on('agent.list', () => ({ value: [agent] }))
  on('session.messages', () => ({ value: turns as never }))
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.read', () => ({ value: '' }))
}

async function step($: any, index: number): Promise<{ text: string; report: string }> {
  const stream = $.turn.step({ turnId: 't', index, model: 'claude-haiku-4-5', messageCount: 1, agentId: 'a1' })
  let text = ''
  let next = await stream.next()
  for (; !next.done; next = await stream.next()) {
    const chunk = next.value as TurnStepChunk
    if (chunk.kind === 'text') text += chunk.text
  }
  const result = next.value
  return { text, report: result.toolUses[0]?.input?.message ?? result.answer }
}

describe('a codex agent', () => {
  test('hands back what Codex asks, and its next message answers the same paused turn', async ($, on) => {
    const turns: ApiTurn[] = [{ role: 'user', content: [{ type: 'text', text: TASK }, { type: 'text', text: REMINDER }] }]
    engine(on, turns)
    const fake = codex(on)

    const asked = await step($, 0)
    expect(asked.report).toContain("Codex asks to run:\n  printf hi > note.txt")
    expect(fake.argv).toContain('approvals_reviewer="user"')
    expect(fake.isClosed).toBe(false)

    turns.push(
      { role: 'assistant', content: [{ type: 'text', text: asked.text }, { type: 'tool_use', id: 'h1', name: HANDBACK, input: { message: asked.report } }] },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'h1', content: 'Report delivered' },
          { type: 'text', text: 'The coordinator sent a message while you were working:\napprove\n\nAddress this before completing your current task.\n' },
          { type: 'text', text: 'approve' },
        ],
      },
    )
    const done = await step($, 1)
    expect(fake.decisions).toEqual(['accept'])
    expect(done.report).toBe('Created note.txt.')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fake.isClosed).toBe(true)
  })

  test('a Codex without app-server says what to install', async ($, on) => {
    engine(on, [{ role: 'user', content: [{ type: 'text', text: 'Read go.mod.' }] }])
    codex(on, true)
    const { report } = await step($, 0)
    expect(report).toContain('codex failed:')
    expect(report).toContain('needs the Codex CLI with `codex app-server`')
  })
})
