import type { Register } from 'claude-code'

import { apply, lines, type Run } from './events'
import { HANDBACK, requestOf } from './request'

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
const FALLBACK = `You stand in for Codex, which failed to start. Call ${HANDBACK} once with the message "codex mod: the run failed to start; see this agent's transcript and the debug log." Do nothing else.`

function argvOf(sandbox: string, sessionId: string | undefined): string[] {
  const common = ['--json', '--skip-git-repo-check']
  return sessionId
    ? ['codex', 'exec', 'resume', ...common, '-c', `sandbox_mode="${sandbox}"`, sessionId, '-']
    : ['codex', 'exec', ...common, '-s', sandbox, '-']
}

function handbackOf(run: Run, code: number | null, stderr: string): string {
  if (run.answer && !run.error && code === 0) return run.answer
  const why = run.error ?? (stderr.trim().split('\n').slice(-5).join('\n') || `exit ${code}`)
  return `${run.answer ? `${run.answer}\n\n` : ''}codex failed: ${why}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const common = { prompt: FALLBACK, tools: ['Read'], model: 'haiku', omitClaudeMd: true } as const
    await $.agent.register({
      ...common,
      name: 'read',
      description:
        'OpenAI Codex in a read-only sandbox: a second opinion, review, research or scoping by a different model. Give it a self-contained prompt; it cannot see this conversation.',
    })
    await $.agent.register({
      ...common,
      name: 'write',
      description:
        'OpenAI Codex with workspace-write in the working directory: bounded implementation by a different model. Give it a self-contained prompt naming the files it owns; it cannot see this conversation.',
    })
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (!agentId) return yield* next(e)
    const agent = (await $.agent.list()).find(a => a.id === agentId)
    const sandbox = agent && SANDBOX[agent.type]
    if (!sandbox) return yield* next(e)

    const rows = await $.session.messages({ agentId })
    if ('deny' in rows) throw new Error(rows.deny)
    const request = requestOf(rows)

    const run: Run = {}
    let progress = ''
    let stderr = ''
    let code: number | null = null
    if (request) {
      const child = $.process.spawn({
        argv: argvOf(sandbox, request.sessionId),
        cwd: await $.session.cwd(),
        input: request.prompt,
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
            const shown = apply(run, line)
            if (shown === undefined) continue
            progress += shown
            yield { kind: 'text', index: 0, text: shown }
          }
        }
        code = (await child.result).code
      } catch (err) {
        if (progress !== '') throw err
        run.error = `the codex CLI did not start (${String(err)}). Install it with \`npm install -g @openai/codex\`, run \`codex login\`, and make sure \`codex\` is on the PATH Claude Code starts with.`
      }
    }

    const message = request ? handbackOf(run, code, stderr) : 'codex: no new request to run.'
    if (progress === '') yield { kind: 'text', index: 0, text: run.error ? `codex: ${run.error}\n` : 'codex: nothing to run.\n' }
    const input = { message }
    yield { kind: 'tool', index: 1, id: `toolu_codex_${crypto.randomUUID().replaceAll('-', '')}`, name: HANDBACK }
    yield { kind: 'input', index: 1, json: JSON.stringify(input) }
    yield { kind: 'stop', stopReason: 'tool_use', usage: null }
    return {
      turnId: e.turnId,
      index: e.index,
      answer: progress,
      toolUses: [{ name: HANDBACK, input }],
      stopReason: 'tool_use',
      usage: null,
    }
  })
}
