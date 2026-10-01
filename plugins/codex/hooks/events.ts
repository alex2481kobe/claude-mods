// Reads `codex exec --json` output: one JSON event per line. Each event
// becomes a line of progress for the agent's transcript, and the run's
// answer is its last agent message.

export type Run = { sessionId?: string; answer?: string; error?: string }

// Splits streamed text into complete lines, keeping the unfinished tail.
export function lines(buffer: string, text: string): { done: string[]; rest: string } {
  const parts = (buffer + text).split('\n')
  return { done: parts.slice(0, -1), rest: parts.at(-1) ?? '' }
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
      return item?.type === 'command_execution' ? `$ ${item.command}\n` : undefined
    case 'item.completed':
      if (item?.type === 'agent_message') {
        run.answer = item.text
        return `${item.text.trimEnd()}\n\n`
      }
      if (item?.type === 'command_execution') return item.exit_code ? `  exit ${item.exit_code}\n` : undefined
      if (item?.type === 'file_change') return `edited ${(item.changes ?? []).map((c: any) => c.path).join(', ')}\n`
      return undefined
    case 'turn.failed':
    case 'error':
      run.error = event.error?.message ?? event.message ?? line
      return `error: ${run.error}\n`
    default:
      return undefined
  }
}
