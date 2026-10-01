import type { SessionMessage } from 'claude-code'

// What a codex agent's loop is being asked, read from its own transcript so
// the mod keeps no state: the spawn prompt on the first run, then whatever
// was sent after the last run, resuming that run's Codex session.

export const HANDBACK = 'SubagentHandback'

const SESSION = /^codex session ([0-9a-f-]{36})$/m

// Rows the engine adds to a subagent's loop that are not the caller's words.
function isEngineRow(text: string): boolean {
  return text.startsWith('<system-reminder>') || text.startsWith('[handback')
}

// `opening` is the spawn prompt, which carries the agent's options.
export type Request = { prompt: string; opening: string; sessionId?: string }

export function requestOf(rows: readonly SessionMessage[]): Request | undefined {
  const first = rows.find(r => r.role === 'user' && r.text !== '' && !isEngineRow(r.text))
  if (!first) return undefined

  // Every assistant row is a run's, whether it finished or was stopped part
  // way; what the caller sends after the last one is the next request.
  let sessionId: string | undefined
  let hasRun = false
  let followUps: string[] = []
  for (const row of rows) {
    if (row.role === 'assistant') {
      sessionId = SESSION.exec(row.text)?.[1] ?? sessionId
      hasRun = true
      followUps = []
    } else if (hasRun && row.text !== '' && !isEngineRow(row.text)) {
      // A message queued while the agent ran arrives on the same row as the
      // result of its last tool call; the row's text is the message alone.
      followUps.push(row.text)
    }
  }

  if (!hasRun) return { prompt: first.text, opening: first.text }
  if (followUps.length === 0) return undefined
  return { prompt: followUps.join('\n\n'), opening: first.text, sessionId }
}

// Whether this loop reports through a SubagentHandback call. An interactive
// session gives subagents the tool and insists on it; a headless or SDK run
// has none and takes the final text as the report. Nothing the loop can read
// says which ahead of time, so it hands back until a handback has failed.
export function handsBack(rows: readonly SessionMessage[]): boolean {
  return !rows.some(r => r.toolUses.some(u => u.tool === HANDBACK && u.isError))
}

// The report of the last handback the loop sent, to repeat it as text when
// the call failed.
export function lastReport(rows: readonly SessionMessage[]): string | undefined {
  let report: string | undefined
  for (const row of rows) {
    for (const use of row.toolUses) {
      if (use.tool === HANDBACK && typeof use.input.message === 'string') report = use.input.message
    }
  }
  return report
}
