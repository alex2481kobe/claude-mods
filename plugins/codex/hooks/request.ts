// What a codex agent's loop is being asked, read from its own conversation so
// the mod keeps no state: the spawn prompt on the first run, then whatever
// was sent after the last run, resuming that run's Codex session.

export const HANDBACK = 'SubagentHandback'

const SESSION = /^codex session ([0-9a-f-]{36})$/m

// Text the engine adds to a subagent's loop that is not the caller's words.
function isEngineText(text: string): boolean {
  return text.startsWith('<system-reminder>') || text.startsWith('[handback')
}

// One turn of the conversation: its words, and its tool calls with whether
// each failed.
export type Row = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly { tool: string; input: Record<string, unknown>; isError?: true }[]
}

type ApiBlock = { type: string; [field: string]: unknown }
export type ApiTurn = { role: 'user' | 'assistant'; content: readonly ApiBlock[] }

// The conversation as the model would be sent it. The engine's own rows
// (`$.session.messages()`) leave out meta rows, and a message queued while the
// agent ran is one, so the API form is the one that holds every request.
export function rowsOf(turns: readonly ApiTurn[]): Row[] {
  const failed = new Set<unknown>()
  for (const turn of turns) {
    for (const block of turn.content) {
      if (block.type === 'tool_result' && block.is_error) failed.add(block.tool_use_id)
    }
  }
  return turns.map(turn => ({
    role: turn.role,
    text: turn.content
      .filter(b => b.type === 'text' && typeof b.text === 'string' && !isEngineText(b.text))
      .map(b => b.text as string)
      .join('\n\n'),
    toolUses: turn.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        tool: String(b.name),
        input: (b.input ?? {}) as Record<string, unknown>,
        ...(failed.has(b.id) ? { isError: true as const } : {}),
      })),
  }))
}

// `opening` is the spawn prompt, which carries the agent's options.
export type Request = { prompt: string; opening: string; sessionId?: string }

export function requestOf(rows: readonly Row[]): Request | undefined {
  const first = rows.find(r => r.role === 'user' && r.text !== '')
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
    } else if (hasRun && row.text !== '') {
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
export function handsBack(rows: readonly Row[]): boolean {
  return !rows.some(r => r.toolUses.some(u => u.tool === HANDBACK && u.isError))
}

// The report of the last handback the loop sent, to repeat it as text when
// the call failed.
export function lastReport(rows: readonly Row[]): string | undefined {
  let report: string | undefined
  for (const row of rows) {
    for (const use of row.toolUses) {
      if (use.tool === HANDBACK && typeof use.input.message === 'string') report = use.input.message
    }
  }
  return report
}
