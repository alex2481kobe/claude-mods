// What a codex agent's loop is being asked: every message in its conversation
// that has not yet been passed to Codex. Position is no guide, since the
// engine may fold a message queued while Codex ran into an earlier turn, so
// the caller keeps the list of messages already passed on (`sent`).

export const HANDBACK = 'SubagentHandback'

const SESSION = /^codex session ([0-9a-f-]{36})$/m

// Text the engine adds to a subagent's loop that is not the caller's words.
function isEngineText(text: string): boolean {
  return text.startsWith('<system-reminder>') || text.startsWith('[handback')
}

// A message sent to a running agent arrives wrapped in the engine's words
// ("… sent a message while you were working: <it> Address this before
// completing your current task."). That is an instruction to a Claude
// subagent; Codex gets the message as it was sent.
const WRAPPED = /^[^\n]*sent a message while you were working:\n([\s\S]*?)\n\nAddress this before completing your current task\.?$/

export function sentAs(text: string): string {
  return WRAPPED.exec(text.trim())?.[1] ?? text
}

// One turn of the conversation: its words, and its tool calls with whether
// each failed.
export type Row = {
  role: 'user' | 'assistant'
  text: string
  texts: readonly string[]
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
  return turns.map(turn => {
    const texts = turn.content
      .filter(b => b.type === 'text' && typeof b.text === 'string' && !isEngineText(b.text))
      .map(b => b.text as string)
    return {
      role: turn.role,
      text: texts.join('\n\n'),
      texts,
    toolUses: turn.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        tool: String(b.name),
        input: (b.input ?? {}) as Record<string, unknown>,
        ...(failed.has(b.id) ? { isError: true as const } : {}),
      })),
    }
  })
}

// `opening` is the spawn prompt, which carries the agent's options; `texts`
// are the messages this request passes on, for the caller to add to `sent`.
export type Request = { prompt: string; opening: string; texts: string[]; sessionId?: string }

export function requestOf(rows: readonly Row[], sent: readonly string[]): Request | undefined {
  const asked = rows.filter(r => r.role === 'user').flatMap(r => r.texts)
  // The opening carries the agent's options. The first text passed to Codex
  // is the true one; the engine may later place another message ahead of it.
  const opening = sent[0] ?? asked[0]
  if (opening === undefined) return undefined

  // Each message once: a text sent twice on purpose is asked twice.
  const left = [...sent]
  const texts = asked.filter(text => {
    const at = left.indexOf(text)
    if (at === -1) return true
    left.splice(at, 1)
    return false
  })
  if (texts.length === 0) return undefined

  let sessionId: string | undefined
  for (const row of rows) {
    if (row.role === 'assistant') sessionId = SESSION.exec(row.text)?.[1] ?? sessionId
  }
  // The engine may place one message twice, wrapped and as sent: once each.
  const said = texts.map(sentAs).filter((text, i, all) => all.indexOf(text) === i)
  return { prompt: said.join('\n\n'), opening, texts, sessionId: sent.length > 0 ? sessionId : undefined }
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

// What the agent last reported: its last turn's handback, or its text where
// the loop reports as text (headless).
export function lastAnswer(rows: readonly Row[]): string | undefined {
  const row = rows.findLast(r => r.role === 'assistant')
  if (!row) return undefined
  const use = row.toolUses.findLast(u => u.tool === HANDBACK && typeof u.input.message === 'string')
  return use ? (use.input.message as string) : row.text
}
