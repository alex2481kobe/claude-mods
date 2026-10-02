import { atom, read, update } from 'claude-code'
import type { EngineInterface, Hook, TurnStepChunk, TurnUsage } from 'claude-code'

import type { CodexRun } from '../types'
import { TYPES } from './agents'
import { answersOf, isCommand, threadParamsOf } from './commands'
import { apply, reportOf, type Run } from './events'
import { flagsOf, type Flags, type Pin } from './flags'
import { labelOf } from './model'
import { expiredAnswer, questionOf, replyOf, type Asked } from './questions'
import { HANDBACK, handsBack, lastAnswer, lastReport, requestOf, rowsOf } from './request'
import { NO_CODEX, open, type Server } from './server'
import { openView, setReply } from './view'

// One step of a codex agent's loop: its model request answered by driving
// `codex app-server`, Codex's steps streamed as the agent's text, and Codex's
// answer or question handed back.

// A Codex turn paused on a question, by agent id: the server stays up until
// the agent's next message answers it.
const held = new Map<string, { server: Server; asked: Asked; threadId: string }>()

// The Codex turn each codex agent is running now, by agent id, so a message
// sent to the agent meanwhile can join it rather than wait for it to end.
const working = new Map<string, { server: Server; threadId: string; turnId: string }>()

// Adds a message to the agent's running Codex turn; false when no turn runs
// or Codex refused (the turn had just ended), so the message takes the usual
// way: the agent's next turn.
export async function steer(agentId: string, text: string): Promise<boolean> {
  const turn = working.get(agentId)
  if (!turn) return false
  try {
    await turn.server.call('turn/steer', { threadId: turn.threadId, expectedTurnId: turn.turnId, input: [{ type: 'text', text }] })
    return true
  } catch {
    return false
  }
}

// Ends every Codex turn left waiting on a question.
export function closeHeld(): void {
  for (const { server } of held.values()) server.close()
  held.clear()
}

// What each codex agent has passed to Codex, so a message is sent once; what
// its commands set; and what Codex last reported running it with.
const sent = atom({ plugin: 'codex', key: 'sent' } as const, {})
const options = atom({ plugin: 'codex', key: 'options' } as const, {})
const runs = atom({ plugin: 'codex', key: 'runs' } as const, {})

const shown = (text: string): TurnStepChunk => ({ kind: 'text', index: 0, text })

// Codex's progress also as notices in the agent's conversation, appended as
// it happens: a notice is what refreshes the agent list's activity line, while
// the agent's view shows the step's text. The model never reads a notice, and
// only the detailed transcript (ctrl+o) shows both. Display only, so a refused
// append changes nothing else.
async function note($: EngineInterface, agentId: string, text: string): Promise<void> {
  await $.session
    .append({ agentId, message: { type: 'system', content: [{ type: 'text', text: text.trimEnd() }] } })
    .catch(() => undefined)
}

// Resolves undefined when the step is aborted first; the listener goes once
// the wait settles, so a long turn does not pile them up on the signal.
export function unlessAborted<T>(signal: AbortSignal, promise: Promise<T>): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined)
  let stop = () => {}
  const aborted = new Promise<undefined>(resolve => {
    stop = () => resolve(undefined)
    signal.addEventListener('abort', stop, { once: true })
  })
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', stop))
}

const EXPIRED =
  'codex: the question Codex asked has expired: the Codex turn that asked it is gone (Codex exited, the session was resumed, or the mod reloaded), so nothing was answered. Send the task again to start a new turn.'

// The agent's `/codex-*` commands, answered in order; a setting is kept for
// its next Codex turn.
async function answered($: EngineInterface, agentId: string, commands: string[], pin?: Pin): Promise<string[]> {
  const last = (await read($, runs))[agentId]
  let replies: string[] = []
  await update($, options, all => {
    const answers = answersOf(commands, all[agentId] ?? {}, pin, last)
    replies = answers.replies
    return { ...all, [agentId]: answers.options }
  })
  return replies
}

// A registered /codex- command acts on the agent whose view is open and
// answers in that view's band; the main conversation is not sent the reply.
export const command: Hook<'command.run'> = async ($, e, next) => {
  if (!isCommand(`/${e.command}`)) return next(e)
  const id = openView()
  const agent = id === undefined ? undefined : (await $.agent.list()).find(a => a.id === id)
  const type = agent && TYPES[agent.type]
  if (!agent || !type) return { text: `Open a codex agent's view to use /${e.command}.` }
  const [reply] = await answered($, agent.id, [`/${e.command} ${e.args}`.trim()], type.pin)
  setReply(agent.id, reply!)
  $.ui.invalidate('ui.render')
  return {}
}

export const step: Hook<'turn.step'> = async function* ($, e, next) {
  const agentId = e.agentId
  if (!agentId) return yield* next(e)
  const agent = (await $.agent.list()).find(a => a.id === agentId)
  const type = agent && TYPES[agent.type]
  if (!type) return yield* next(e)

  const api = await $.session.messages({ as: 'api', agentId })
  if ('deny' in api) throw new Error(api.deny)
  const rows = rowsOf(api)
  const request = requestOf(rows, (await read($, sent))[agentId] ?? [])
  // Codex's progress is the transcript's text; the report goes back with a
  // handback call, or as the final text where the loop has no such tool.
  const handback = handsBack(rows)

  const run: Run = {}
  let progress = ''
  let question: string | undefined
  let model = 'codex'
  let server: Server | undefined
  const show = (text: string) => {
    progress += text
    return shown(text)
  }
  // A `/codex-*` message is the mod's to answer; the rest is Codex's.
  const asked = request?.texts.filter(text => !isCommand(text)) ?? []
  const replies = request ? await answered($, agentId, request.texts.filter(isCommand), type.pin) : []
  for (const reply of replies) {
    yield show(`${reply}\n\n`)
    await note($, agentId, reply)
  }
  let report: Omit<CodexRun, 'tokens'> | undefined
  if (request) {
    const prompt = asked.join('\n\n')
    const pending = held.get(agentId)
    const reply = pending && replyOf(pending.asked, prompt)
    const cwd = await $.session.cwd()
    try {
      if (asked.length === 0) {
        // Commands alone: Codex is not asked, and a question it asked still waits.
      } else if (pending?.server.isEnded() || (!pending && expiredAnswer(lastAnswer(rows), prompt))) {
        held.delete(agentId)
        question = EXPIRED
      } else if (pending && !reply) {
        // Not an answer: ask again, Codex still waiting.
        question = `That does not answer Codex.\n\n${questionOf(pending.asked)}`
      } else if (pending && reply) {
        held.delete(agentId)
        server = pending.server
        run.threadId = pending.threadId
        await server.respond(pending.asked.id, reply)
        yield show(`answered Codex\n`)
        await note($, agentId, 'answered Codex')
      } else {
        // The spawn prompt's flags hold for every run of the agent; they are
        // not part of the task.
        const first = request.sessionId === undefined
        const flags = flagsOf(request.opening, type.pin)
        if ('error' in flags) throw new Error(flags.error)
        const set = threadParamsOf((await read($, options))[agentId] ?? {})
        server = await open({ spawn: r => $.process.spawn(r), write: (p, t) => $.fs.write(p, t), stat: p => $.fs.stat(p) }, flags.args, cwd)
        const where = flags.cwd ?? cwd
        const config = { ...set.config, ...(await rootsOf(server, flags.addDirs)) }
        const overrides = { ...set, ...(Object.keys(config).length > 0 ? { config } : {}) }
        const thread = first
          ? await server.call('thread/start', { cwd: where, ...(flags.ephemeral ? { ephemeral: true } : {}), ...overrides })
          : await server.call('thread/resume', { threadId: request.sessionId, cwd: where, ...overrides })
        // What the session runs on, as Codex reports it.
        report = reportOf(thread)
        run.threadId = report.threadId
        model = report.model
        yield show(`codex ${labelOf({}, { model: report.model, effort: report.effort ?? undefined })} · ${type.shown}\ncodex session ${run.threadId}\n\n`)
        const images = flags.images.map(path => ({ type: 'localImage', path }))
        const schema = flags.outputSchema ? { outputSchema: JSON.parse(await $.fs.read(flags.outputSchema)) } : {}
        const opens = asked[0] === request.opening
        const text = opens ? (flagsOf(prompt, type.pin) as Flags).prompt : prompt
        const started = await server.call('turn/start', { threadId: run.threadId, input: [{ type: 'text', text }, ...images], ...schema })
        if (started?.turn?.id) working.set(agentId, { server, threadId: run.threadId!, turnId: started.turn.id })
      }
      while (server && !question) {
        const message = await unlessAborted(next.signal, server.next())
        if (!message) {
          if (!next.signal.aborted) run.error = `codex app-server exited: ${server.stderr().trim().split('\n').at(-1) || 'no reason given'}`
          break
        }
        if (message.id !== undefined) {
          const asked = { id: message.id, method: message.method, params: message.params }
          question = questionOf(asked)
          if (question) held.set(agentId, { server, asked, threadId: run.threadId! })
          else await server.respond(message.id, replyOf(asked, '')!)
          continue
        }
        const step = apply(run, message.method, message.params)
        if (step !== undefined) {
          yield show(step)
          await note($, agentId, step)
        }
        if (run.isDone) break
      }
    } catch (err) {
      run.error = (err as Error).message
      // Only a missing CLI, or one too old for app-server, earns the hint.
      if (`${run.error}\n${server?.stderr() ?? ''}`.includes(NO_CODEX) || /unrecognized subcommand '?app-server/.test(`${run.error}\n${server?.stderr() ?? ''}`)) {
        run.error += '. The codex mod needs the Codex CLI with `codex app-server` (0.159 or newer): `npm install -g @openai/codex`, then `codex login`.'
      }
    } finally {
      working.delete(agentId)
      if (server && !held.has(agentId)) server.close()
      await update($, sent, all => ({ ...all, [agentId]: [...(all[agentId] ?? []), ...request.texts] }))
      // What Codex reported this session runs with, and its token total.
      await update($, runs, all => {
        const base = report ?? all[agentId]
        return base ? { ...all, [agentId]: { ...base, tokens: run.tokens ?? all[agentId]?.tokens ?? { input: 0, cached: 0, output: 0 } } } : all
      })
    }
  }

  // Codex's own token counts, so the agent's row shows what the run cost.
  const usage: TurnUsage | null = run.usage ? { ...run.usage, model } : null
  const codexSaid = question
    ? question
    : asked.length > 0
      ? run.error
        ? `${run.answer ? `${run.answer}\n\n` : ''}codex failed: ${run.error}`
        : (run.answer ?? 'codex: the turn ended without a message.')
      : undefined
  const message = request ? [...replies, ...(codexSaid ? [codexSaid] : [])].join('\n\n') : (lastReport(rows) ?? 'codex: no new request to run.')
  if (!handback) {
    // The session line lets a follow-up resume this run (see requestOf).
    const text = run.threadId ? `${message}\n\ncodex session ${run.threadId}` : message
    yield { kind: 'text', index: 1, text }
    yield { kind: 'stop', stopReason: 'end_turn', usage }
    return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: 'end_turn', usage }
  }
  if (progress === '' && !question) yield show(run.error ? `codex: ${run.error}\n` : 'codex: nothing to run.\n')
  const input = { message }
  yield { kind: 'tool', index: 1, id: `toolu_codex_${crypto.randomUUID().replaceAll('-', '')}`, name: HANDBACK }
  yield { kind: 'input', index: 1, json: JSON.stringify(input) }
  yield { kind: 'stop', stopReason: 'tool_use', usage }
  return { turnId: e.turnId, index: e.index, answer: progress, toolUses: [{ name: HANDBACK, input }], stopReason: 'tool_use', usage }
}

// `add-dir`: the config's writable roots plus the ones asked for, since a
// thread's setting replaces the config's list rather than adding to it.
async function rootsOf(server: Server, dirs: readonly string[]): Promise<Record<string, unknown>> {
  if (dirs.length === 0) return {}
  const { config } = await server.call('config/read', {})
  return { 'sandbox_workspace_write.writable_roots': [...(config?.sandbox_workspace_write?.writable_roots ?? []), ...dirs] }
}
