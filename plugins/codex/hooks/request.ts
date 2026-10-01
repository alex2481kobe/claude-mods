import type { SessionMessage } from 'claude-code'

// What a codex agent's loop is being asked, read from its own transcript so
// the mod keeps no state: the spawn prompt, or the follow-ups sent after its
// last handback, with the Codex session to resume.

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

  let sessionId: string | undefined
  let handedBack = false
  let followUps: string[] = []
  for (const row of rows) {
    if (row.role === 'assistant') {
      sessionId = SESSION.exec(row.text)?.[1] ?? sessionId
      if (row.toolUses.some(u => u.tool === HANDBACK)) {
        handedBack = true
        followUps = []
      }
    } else if (handedBack && row.text !== '' && !isEngineRow(row.text) && !row.toolResults?.length) {
      followUps.push(row.text)
    }
  }

  if (!handedBack) return { prompt: first.text, opening: first.text }
  if (followUps.length === 0) return undefined
  return { prompt: followUps.join('\n\n'), opening: first.text, sessionId }
}
