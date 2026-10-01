// Reads `codex exec --json` output: one JSON event per line. Each event
// becomes a line of progress for the agent's transcript, the run's answer is
// its last agent message, and `doing` says what Codex is doing right now.

export type Run = { sessionId?: string; answer?: string; error?: string; doing?: string }

// Splits streamed text into complete lines, keeping the unfinished tail.
export function lines(buffer: string, text: string): { done: string[]; rest: string } {
  const parts = (buffer + text).split('\n')
  return { done: parts.slice(0, -1), rest: parts.at(-1) ?? '' }
}

// `/bin/zsh -lc 'cat go.mod'` reads `cat go.mod`.
function commandOf(command: string): string {
  return /^\S*sh -lc '(.*)'$/s.exec(command)?.[1] ?? command
}

function firstLine(text: string, room = 60): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > room ? `${line.slice(0, room - 1)}…` : line
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
    case 'turn.started':
      run.doing = 'Thinking'
      return undefined
    case 'item.started':
      if (item?.type === 'reasoning') run.doing = 'Thinking'
      if (item?.type === 'command_execution') {
        run.doing = `Running ${firstLine(commandOf(item.command))}`
        return `$ ${commandOf(item.command)}\n`
      }
      return undefined
    case 'item.completed':
      if (item?.type === 'agent_message') {
        run.answer = item.text
        run.doing = firstLine(item.text)
        return `${item.text.trimEnd()}\n\n`
      }
      if (item?.type === 'command_execution') {
        run.doing = 'Thinking'
        return item.exit_code ? `  exit ${item.exit_code}\n` : undefined
      }
      if (item?.type === 'file_change') {
        const paths = (item.changes ?? []).map((c: any) => c.path).join(', ')
        run.doing = firstLine(`Edited ${paths}`)
        return `edited ${paths}\n`
      }
      return undefined
    case 'turn.completed':
      // An `error` event may be a retry Codex recovered from; the turn's
      // completion clears it.
      run.error = undefined
      return undefined
    case 'turn.failed':
    case 'error':
      run.error = event.error?.message ?? event.message ?? line
      return `error: ${run.error}\n`
    default:
      return undefined
  }
}
