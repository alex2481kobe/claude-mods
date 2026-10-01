import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnStepChunk, TurnUsage } from 'claude-code'

import { apply, lines, type Run } from './events'
import { configOf, labelOf, modelsOf, type Choice } from './model'
import { optionsOf, overridesOf, type Options } from './options'
import { HANDBACK, handsBack, lastReport, requestOf, rowsOf } from './request'

// Codex as native subagent types. The Agent tool starts one like any other
// subagent (task list, background, SendMessage); a turn.step hook answers its
// loop's model request by running `codex exec` and streaming what Codex does
// into the agent's transcript, then hands Codex's answer back. No Claude model
// runs, and stopping the agent kills Codex with it.

const SANDBOX: Record<string, string> = {
  'codex:read': 'read-only',
  'codex:write': 'workspace-write',
}

// Only reached if the turn.step hook fails, so the failure is not mistaken
// for an answer.
const FALLBACK = `You stand in for Codex, which failed to start. Report exactly "codex mod: the run failed to start; see this agent's transcript and the debug log." as your final report, and do nothing else.`

function argvOf(sandbox: string, sessionId: string | undefined, options: Options): string[] {
  // Headless: nobody can approve an escalation, and none may widen the sandbox.
  const common = ['--json', '--skip-git-repo-check', '-c', 'approval_policy="never"', ...overridesOf(options)]
  return sessionId
    ? ['codex', 'exec', 'resume', ...common, '-c', `sandbox_mode="${sandbox}"`, sessionId, '-']
    : ['codex', 'exec', ...common, '-s', sandbox, '-']
}

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
  ` To choose a Codex model or reasoning effort, start the prompt with a line \`model: <id>\` and/or \`effort: <level>\`` +
  (models.length > 0 ? ` (models: ${models.join(', ')})` : '') +
  `; left out, Codex uses its own config.`

// What each codex agent has passed to Codex, so a message is sent once.
const sent = atom({ plugin: 'codex', key: 'sent' } as const, {})

// Codex's progress as notices in the agent's conversation, appended as it
// happens: the agent's view shows them live, and the agent list's activity
// line follows them as it follows a native agent's steps. The model never
// reads a notice. Display only, so a refused append changes nothing else.
async function note($: EngineInterface, agentId: string, text: string): Promise<void> {
  await $.session
    .append({ agentId, message: { type: 'system', content: [{ type: 'text', text: text.trimEnd() }] } })
    .catch(() => undefined)
}

function handbackOf(run: Run, code: number | null, stderr: string): string {
  if (run.answer && !run.error && code === 0) return run.answer
  const why = run.error ?? (stderr.trim().split('\n').slice(-5).join('\n') || `exit ${code}`)
  return `${run.answer ? `${run.answer}\n\n` : ''}codex failed: ${why}`
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
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    if (!(e.subagentType in SANDBOX)) return next(e)
    const label = labelOf(await codexConfig($), optionsOf(e.prompt))
    return next({ ...e, description: `${e.description} · ${label}` })
  })

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (!agentId) return yield* next(e)
    const agent = (await $.agent.list()).find(a => a.id === agentId)
    const sandbox = agent && SANDBOX[agent.type]
    if (!sandbox) return yield* next(e)

    const api = await $.session.messages({ as: 'api', agentId })
    if ('deny' in api) throw new Error(api.deny)
    const rows = rowsOf(api)
    const request = requestOf(rows, (await read($, sent))[agentId] ?? [])
    // Codex's progress is the transcript's text; the report goes back with a
    // handback call, or as the final text where the loop has no such tool.
    const handback = handsBack(rows)
    const shown = (text: string): TurnStepChunk => ({ kind: 'text', index: 0, text })

    const run: Run = {}
    let progress = ''
    let stderr = ''
    let code: number | null = null
    let model = 'codex'
    if (request) {
      const options = optionsOf(request.opening)
      const asked = request.texts
      const config = await codexConfig($)
      model = options.model ?? config.model ?? model
      const label = labelOf(config, options)
      const header = `codex ${label} · ${sandbox}\n`
      progress += header
      yield shown(header)
      const child = $.process.spawn({
        argv: argvOf(sandbox, request.sessionId, options),
        cwd: await $.session.cwd(),
        input: request.sessionId ? request.prompt : optionsOf(request.prompt).prompt,
      })
      let buffer = ''
      try {
        for await (const chunk of child) {
          if (chunk.stream === 'stderr') {
            stderr = (stderr + chunk.text).slice(-4000)
            continue
          }
          const split = lines(buffer, chunk.text)
          buffer = split.rest
          for (const line of split.done) {
            const step = apply(run, line)
            if (step === undefined) continue
            progress += step
            // The session line stays in the agent's own text: a follow-up
            // resumes the Codex session it names.
            if (step.startsWith('codex session ')) yield shown(step)
            else await note($, agentId, step)
          }
        }
        if (buffer.trim() !== '') {
          const step = apply(run, buffer)
          if (step !== undefined) {
            progress += step
            if (step.startsWith('codex session ')) yield shown(step)
            else await note($, agentId, step)
          }
        }
        code = (await child.result).code
      } catch (err) {
        if (progress !== header) throw err
        run.error = `the codex CLI did not start (${String(err)}). Install it with \`npm install -g @openai/codex\`, run \`codex login\`, and make sure \`codex\` is on the PATH Claude Code starts with.`
      } finally {
        await update($, sent, all => ({ ...all, [agentId]: [...(all[agentId] ?? []), ...asked] }))
      }
    }

    // Codex's own token counts, so the agent's row shows what the run cost.
    const usage: TurnUsage | null = run.usage ? { ...run.usage, model } : null
    const message = request ? handbackOf(run, code, stderr) : (lastReport(rows) ?? 'codex: no new request to run.')
    if (!handback) {
      // The session line lets a follow-up resume this run (see requestOf).
      const text = run.sessionId ? `${message}\n\ncodex session ${run.sessionId}` : message
      yield { kind: 'text', index: 1, text }
      yield { kind: 'stop', stopReason: 'end_turn', usage }
      return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: 'end_turn', usage }
    }
    if (progress === '') yield shown(run.error ? `codex: ${run.error}\n` : 'codex: nothing to run.\n')
    const input = { message }
    yield { kind: 'tool', index: 1, id: `toolu_codex_${crypto.randomUUID().replaceAll('-', '')}`, name: HANDBACK }
    yield { kind: 'input', index: 1, json: JSON.stringify(input) }
    yield { kind: 'stop', stopReason: 'tool_use', usage }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: progress,
      toolUses: [{ name: HANDBACK, input }],
      stopReason: 'tool_use',
      usage,
    }
  })
}
