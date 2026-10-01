import { describe, expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, TurnStepChunk } from 'claude-code'

import { unlessAborted } from '../hooks/register'
import { HANDBACK, type ApiTurn } from '../hooks/request'

// The test runner has timers; the mod's own environment declares none.
declare const setTimeout: (run: () => void, ms: number) => unknown

// A TMPDIR holding a quote and a backslash, which the FIFO line carries as is.
const FIFO = '/tmp/we"ird\\dir/codex-mod.test/in'
const TASK = 'model: gpt-6-luna\nsandbox: read-only\nask-for-approval: on-request\nconfig: approvals_reviewer="user"\nCreate note.txt.'
const INSTALL = 'needs the Codex CLI with `codex app-server`'
const REMINDER = `<system-reminder>\nYour final report is delivered through ${HANDBACK}.\n</system-reminder>`

type Fake = { argv: string[]; decisions: unknown[]; isClosed: boolean; writesAfterClose: number }

// How the stand-in ends: answers and finishes (`ok`), dies while its question
// waits (`crash`), or the shell finds no app-server, no codex, or Codex fails
// on its own "not found".
type Mode = 'ok' | 'crash' | 'no-app-server' | 'no-codex' | 'config-not-found'

// A stand-in for `codex app-server` behind the mod's shell: it reads the
// mod's JSON-RPC from the FIFO, answers it on stdout, asks for one approval
// in its turn, and finishes the turn once that is answered. The FIFO is there
// only while it runs, as the shell removes it on the way out.
function codex(on: On, mode: Mode = 'ok'): Fake {
  const fake: Fake = { argv: [], decisions: [], isClosed: false, writesAfterClose: 0 }
  const out: string[] = []
  let wake: (() => void) | undefined
  const send = (message: object) => {
    out.push(JSON.stringify(message))
    wake?.()
  }
  on('process.spawn', async function* (_$, e) {
    fake.argv = [...e.argv]
    if (mode === 'no-codex') {
      fake.isClosed = true
      yield { stream: 'stderr' as const, text: 'codex-mod: codex: command not found\n' }
      return { value: { code: 127, signal: null } }
    }
    yield { stream: 'stdout' as const, text: `codex-mod fifo ${FIFO}\n` }
    if (mode === 'no-app-server' || mode === 'config-not-found') {
      fake.isClosed = true
      const said = mode === 'no-app-server' ? "error: unrecognized subcommand 'app-server'" : 'error: config profile not found'
      yield { stream: 'stderr' as const, text: `${said}\n` }
      return { value: { code: 2, signal: null } }
    }
    try {
      for (;;) {
        // Idle, it still yields now and then, so a close reaches it as it
        // reaches a real child.
        if (out.length === 0) await new Promise<void>(resolve => ((wake = resolve), setTimeout(resolve, 5)))
        if (mode === 'crash' && fake.decisions.length === 0 && out.length === 0 && asked) return { value: { code: 1, signal: null } }
        yield { stream: 'stdout' as const, text: out.length > 0 ? `${out.shift()}\n` : '' }
      }
    } finally {
      fake.isClosed = true
    }
  })
  let asked = false
  on('fs.stat', (_$, e) => {
    if (e.path === FIFO && !fake.isClosed) return { value: { kind: 'other', size: 0, mtimeMs: 0, isLink: false } }
    throw new Error(`ENOENT: no such file or directory, stat '${e.path}'`)
  })
  on('fs.write', (_$, e) => {
    if (e.path !== FIFO) return { value: undefined }
    if (fake.isClosed) fake.writesAfterClose++
    for (const line of e.text.split('\n').filter(Boolean)) {
      const m = JSON.parse(line)
      if (m.method === 'initialize') send({ id: m.id, result: {} })
      if (m.method === 'thread/start' || m.method === 'thread/resume') send({ id: m.id, result: { thread: { id: 'th1' } } })
      if (m.method === 'turn/start') {
        send({ id: m.id, result: { turn: { id: 't1' } } })
        send({ id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 'th1', command: "/bin/zsh -lc 'printf hi > note.txt'", cwd: '/work' } })
        asked = true
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
    // The agent's own text is the header and the session line; the rest of
    // Codex's progress is appended as notices as it happens (the test runner
    // stores no appended row, so only what is not yielded is checked here).
    expect(asked.text).toBe('codex Luna 6 · Codex\ncodex session th1\n\n')
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
    expect(done.text).toBe('')
    await new Promise<void>(resolve => setTimeout(() => resolve(), 20))
    expect(fake.isClosed).toBe(true)
  })

  test('a Codex without app-server says what to install, and nothing is written once it is gone', async ($, on) => {
    engine(on, [{ role: 'user', content: [{ type: 'text', text: 'Read go.mod.' }] }])
    const fake = codex(on, 'no-app-server')
    const { report } = await step($, 0)
    expect(report).toContain('codex failed:')
    expect(report).toContain(INSTALL)
    expect(fake.writesAfterClose).toBe(0)
  })

  test('no codex on the PATH says what to install', async ($, on) => {
    engine(on, [{ role: 'user', content: [{ type: 'text', text: 'Read go.mod.' }] }])
    codex(on, 'no-codex')
    expect((await step($, 0)).report).toContain(INSTALL)
  })

  test('a "not found" of Codex\'s own is not taken for a missing CLI', async ($, on) => {
    engine(on, [{ role: 'user', content: [{ type: 'text', text: 'Read go.mod.' }] }])
    codex(on, 'config-not-found')
    const { report } = await step($, 0)
    expect(report).toContain('config profile not found')
    expect(report).not.toContain(INSTALL)
  })

  test('an answer to a question whose Codex has gone says so and starts no new turn', async ($, on) => {
    const turns: ApiTurn[] = [{ role: 'user', content: [{ type: 'text', text: TASK }, { type: 'text', text: REMINDER }] }]
    engine(on, turns)
    const fake = codex(on, 'crash')
    const asked = await step($, 0)
    expect(asked.report).toContain('Codex asks to run:')
    await new Promise<void>(resolve => setTimeout(() => resolve(), 30))
    expect(fake.isClosed).toBe(true)
    const spawned = fake.argv
    fake.argv = []
    turns.push(
      { role: 'assistant', content: [{ type: 'text', text: asked.text }, { type: 'tool_use', id: 'h1', name: HANDBACK, input: { message: asked.report } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'h1', content: 'Report delivered' }, { type: 'text', text: 'approve' }] },
    )
    const { report } = await step($, 1)
    expect(report).toContain('expired')
    expect(fake.decisions).toEqual([])
    expect(fake.argv).toEqual([])
    expect(fake.writesAfterClose).toBe(0)
    expect(spawned.length).toBeGreaterThan(0)
  })
})

describe('unlessAborted', () => {
  test('leaves no listener on the signal once each wait settles', async () => {
    let listeners = 0
    const signal = {
      aborted: false,
      addEventListener: () => void listeners++,
      removeEventListener: () => void listeners--,
    } as unknown as AbortSignal
    for (let i = 0; i < 50; i++) await unlessAborted(signal, Promise.resolve(i))
    expect(listeners).toBe(0)
  })
})
