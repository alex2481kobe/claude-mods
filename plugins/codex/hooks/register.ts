import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepChunk, TurnUsage } from 'claude-code'

import { apply, type Run } from './events'
import { flagsOf, FLAG_NAMES, type Flags, type Pin } from './flags'
import { configOf, labelOf, modelsOf, type Choice } from './model'
import { questionOf, replyOf, type Asked } from './questions'
import { HANDBACK, handsBack, lastReport, requestOf, rowsOf } from './request'
import { open, type Server } from './server'

// Codex as native subagent types. The Agent tool starts one like any other
// subagent (task list, background, SendMessage); a turn.step hook answers its
// loop's model request by driving `codex app-server`, streaming what Codex
// does into the agent's transcript, then hands Codex's answer back. What
// Codex asks on the way (an approval, a question) is handed back the same
// way, and the agent's next message answers it. No Claude model runs.

const TYPES: Record<string, { pin?: Pin; shown: string }> = {
  'codex:read': { pin: { sandbox: 'read-only' }, shown: 'Codex read-only' },
  'codex:write': { pin: { sandbox: 'workspace-write' }, shown: 'Codex workspace-write' },
  'codex:run': { shown: 'Codex' },
}

// Only reached if the turn.step hook fails, so the failure is not mistaken
// for an answer.
const FALLBACK = `You stand in for Codex, which failed to start. Report exactly "codex mod: the run failed to start; see this agent's transcript and the debug log." as your final report, and do nothing else.`

// A Codex turn paused on a question, by agent id: the server stays up until
// the agent's next message answers it.
const held = new Map<string, { server: Server; asked: Asked; threadId: string }>()

async function codexHome($: EngineInterface): Promise<string> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  return (await $.env.get('CODEX_HOME')) ?? `${home}/.codex`
}

async function readOr($: EngineInterface, path: string): Promise<string> {
  try {
    return await $.fs.read(path)
  } catch {
    return ''
  }
}

// The model and effort Codex's config.toml names; empty when it names none.
async function codexConfig($: EngineInterface): Promise<Choice> {
  return configOf(await readOr($, `${await codexHome($)}/config.toml`))
}

const CHOOSING = (models: string[]) =>
  ` Codex CLI flags may open the prompt, one per line as \`codex exec --help\` names them without dashes (\`model: <id>\`, \`effort: <level>\`` +
  (models.length > 0 ? `; models: ${models.join(', ')}` : '') +
  `); left out, Codex uses its own config. When Codex asks for an approval or an answer, the agent reports the question; send it the reply as a message.`

// What each codex agent has passed to Codex, so a message is sent once.
const sent = atom({ plugin: 'codex', key: 'sent' } as const, {})

const shown = (text: string): TurnStepChunk => ({ kind: 'text', index: 0, text })

// Resolves undefined when the step is aborted first.
function unlessAborted<T>(signal: AbortSignal, promise: Promise<T>): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined)
  return Promise.race([promise, new Promise<undefined>(resolve => signal.addEventListener('abort', () => resolve(undefined)))])
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const common = { prompt: FALLBACK, tools: ['Read'], model: 'haiku', omitClaudeMd: true } as const
    const choosing = CHOOSING(modelsOf(await readOr($, `${await codexHome($)}/models_cache.json`)))
    await $.agent.register({
      ...common,
      name: 'read',
      description:
        'OpenAI Codex in a read-only sandbox: a second opinion, review, research or scoping by a different model. Give it a self-contained prompt; it cannot see this conversation.' + choosing,
    })
    await $.agent.register({
      ...common,
      name: 'write',
      description:
        'OpenAI Codex with workspace-write in the working directory: bounded implementation by a different model. Give it a self-contained prompt naming the files it owns; it cannot see this conversation.' + choosing,
    })
    await $.agent.register({
      ...common,
      name: 'run',
      description:
        `OpenAI Codex as your Codex config sets it up (sandbox, approvals, reviewer), changed per call by any of its flags: ${FLAG_NAMES.join(', ')}. Codex's own requirements decide what it accepts. Give it a self-contained prompt; it cannot see this conversation.` + choosing,
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    for (const { server } of held.values()) server.close()
    held.clear()
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const type = TYPES[e.subagentType]
    if (!type) return next(e)
    const flags = flagsOf(e.prompt, type.pin)
    const label = labelOf(await codexConfig($), 'error' in flags ? {} : flags)
    return next({ ...e, description: `${e.description} · ${label}` })
  })

  // The transcript's Agent row names the type in words, not `codex:read`.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const input = e.props.input as { subagent_type?: unknown } | undefined
    const type = e.props.tool === 'Agent' && typeof input?.subagent_type === 'string' ? TYPES[input.subagent_type] : undefined
    if (!type) return next(e)
    return next({ ...e, props: { ...e.props, input: { ...input, subagent_type: type.shown } } })
  })

  on('turn.step', async function* ($, e, next) {
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
    if (request) {
      const pending = held.get(agentId)
      const reply = pending && replyOf(pending.asked, request.prompt)
      const cwd = await $.session.cwd()
      try {
        if (pending && !reply) {
          // Not an answer: ask again, Codex still waiting.
          question = `That does not answer Codex.\n\n${questionOf(pending.asked)}`
        } else if (pending && reply) {
          held.delete(agentId)
          server = pending.server
          run.threadId = pending.threadId
          await server.respond(pending.asked.id, reply)
          yield show(`answered Codex\n`)
        } else {
          // The spawn prompt's flags hold for every run of the agent; they are
          // not part of the task.
          const first = request.sessionId === undefined
          const flags = flagsOf(request.opening, type.pin)
          if ('error' in flags) throw new Error(flags.error)
          const config = await codexConfig($)
          model = flags.model ?? config.model ?? model
          yield show(`codex ${labelOf(config, flags)} · ${type.shown}\n`)
          server = await open({ spawn: r => $.process.spawn(r), write: (p, t) => $.fs.write(p, t) }, flags.args, cwd)
          const where = flags.cwd ?? cwd
          const thread = first
            ? await server.call('thread/start', { cwd: where, ...(flags.ephemeral ? { ephemeral: true } : {}), ...(await rootsOf(server, flags.addDirs)) })
            : await server.call('thread/resume', { threadId: request.sessionId, cwd: where })
          run.threadId = thread.thread.id
          yield show(`codex session ${run.threadId}\n\n`)
          const images = flags.images.map(path => ({ type: 'localImage', path }))
          const schema = flags.outputSchema ? { outputSchema: JSON.parse(await $.fs.read(flags.outputSchema)) } : {}
          const opens = request.texts[0] === request.opening
          const text = opens ? (flagsOf(request.prompt, type.pin) as Flags).prompt : request.prompt
          await server.call('turn/start', { threadId: run.threadId, input: [{ type: 'text', text }, ...images], ...schema })
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
          if (step !== undefined) yield show(step)
          if (run.isDone) break
        }
      } catch (err) {
        run.error = (err as Error).message
        if (/ENOENT|not found|unrecognized subcommand/i.test(`${run.error} ${server?.stderr() ?? ''}`)) {
          run.error += '. The codex mod needs the Codex CLI with `codex app-server` (0.159 or newer): `npm install -g @openai/codex`, then `codex login`.'
        }
      } finally {
        if (server && !held.has(agentId)) server.close()
        await update($, sent, all => ({ ...all, [agentId]: [...(all[agentId] ?? []), ...request.texts] }))
      }
    }

    // Codex's own token counts, so the agent's row shows what the run cost.
    const usage: TurnUsage | null = run.usage ? { ...run.usage, model } : null
    const message = question
      ? question
      : request
        ? run.error
          ? `${run.answer ? `${run.answer}\n\n` : ''}codex failed: ${run.error}`
          : (run.answer ?? 'codex: the turn ended without a message.')
        : (lastReport(rows) ?? 'codex: no new request to run.')
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
  })
}

// `add-dir`: the config's writable roots plus the ones asked for, since a
// thread's setting replaces the config's list rather than adding to it.
async function rootsOf(server: Server, dirs: readonly string[]): Promise<object> {
  if (dirs.length === 0) return {}
  const { config } = await server.call('config/read', {})
  const roots = [...(config?.sandbox_workspace_write?.writable_roots ?? []), ...dirs]
  return { config: { 'sandbox_workspace_write.writable_roots': roots } }
}
