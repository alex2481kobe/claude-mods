// Reads `codex exec --json` output: one JSON event per line. Each event
// becomes a line of progress for the agent's transcript, the run's answer is
// its last agent message, and its usage is what the turn cost.

import type { ModelUsage } from 'claude-code'

export type Run = { sessionId?: string; answer?: string; error?: string; usage?: ModelUsage }

// Codex counts cached tokens inside `input_tokens`; the engine's shape counts
// them apart, as the Messages API does.
function usageOf(usage: any): ModelUsage {
  const cached = Number(usage?.cached_input_tokens) || 0
  return {
    input_tokens: Math.max(0, (Number(usage?.input_tokens) || 0) - cached),
    output_tokens: Number(usage?.output_tokens) || 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: Number(usage?.cache_write_input_tokens) || 0,
  }
}

// Splits streamed text into complete lines, keeping the unfinished tail.
export function lines(buffer: string, text: string): { done: string[]; rest: string } {
  const parts = (buffer + text).split('\n')
  return { done: parts.slice(0, -1), rest: parts.at(-1) ?? '' }
}

// `/bin/zsh -lc 'cat go.mod'` reads `cat go.mod`.
function commandOf(command: string): string {
  return /^\S*sh -lc '(.*)'$/s.exec(command)?.[1] ?? command
}


// Folds one event line into the run and returns the progress it shows, if any.
export function apply(run: Run, line: string): string | undefined {
  let event: any
  try {
    event = JSON.parse(line)
  } catch {
    return line.trim() === '' ? undefined : `${line}\n`
  }
  const item = event?.item
  switch (event?.type) {
    case 'thread.started':
      run.sessionId = event.thread_id
      return `codex session ${event.thread_id}\n\n`
    case 'item.started':
      return item?.type === 'command_execution' ? `$ ${commandOf(item.command)}\n` : undefined
    case 'item.completed':
      if (item?.type === 'agent_message') {
        run.answer = item.text
        return `${item.text.trimEnd()}\n\n`
      }
      if (item?.type === 'command_execution') return item.exit_code ? `  exit ${item.exit_code}\n` : undefined
      if (item?.type === 'file_change') return `edited ${(item.changes ?? []).map((c: any) => c.path).join(', ')}\n`
      return undefined
    case 'turn.completed':
      // An `error` event may be a retry Codex recovered from; the turn's
      // completion clears it.
      run.error = undefined
      run.usage = usageOf(event.usage)
      return undefined
    case 'turn.failed':
    case 'error':
      run.error = event.error?.message ?? event.message ?? line
      return `error: ${run.error}\n`
    default:
      return undefined
  }
}
