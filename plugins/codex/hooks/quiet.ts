import type { Hook } from 'claude-code'

import { rowsOf } from './request'

// The main conversation and a codex agent's reports. A run that answered
// only what the user typed in the agent's view was already read there, so
// when its report, and the notice that the agent finished, are all that is
// new to the main conversation, that turn is answered with no model call: the
// rows stay in its history, and Claude does not reply to them. A run Claude
// asked for (the spawn prompt, its SendMessage) reports as usual.

// Whether each codex agent's last run answered the user alone, by agent id;
// a reload forgets it, and the main conversation then replies as usual.
const quiet = new Map<string, boolean>()

export function markQuiet(agentId: string, isQuiet: boolean): void {
  quiet.set(agentId, isQuiet)
}

const REPORT = /^Another Claude session sent a message:\n<agent-message from="([^"]+)">/
const FINISHED = /^<task-notification>\s*<task-id>([^<]+)<\/task-id>/

// A local command's rows (opening the agent's view with /tasks leaves some),
// which never ask the model for a reply on their own.
const LOCAL_COMMAND = /^<(?:command-name|local-command-stdout|local-command-stderr|local-command-caveat)>/

// Whether the texts hold a report or finish notice of a quiet run, and
// nothing else but local commands' rows.
export function isQuietInput(texts: readonly string[]): boolean {
  const asking = texts.filter(text => !LOCAL_COMMAND.test(text))
  return asking.length > 0 && asking.every(text => quiet.get((REPORT.exec(text) ?? FINISHED.exec(text))?.[1] ?? '') === true)
}

// The main conversation's answer to such a turn: a line, as Claude Code
// takes an answer with nothing to show for a failed one and asks again.
export const QUIET_LINE = 'Codex answered in the agent\'s view.'

export const quietMain: Hook<'turn.step'> = async function* ($, e, next) {
  if (e.agentId !== undefined || e.index !== 0) return yield* next(e)
  const api = await $.session.messages({ as: 'api' })
  if ('deny' in api) return yield* next(e)
  const rows = rowsOf(api)
  const texts = rows.slice(rows.findLastIndex(row => row.role === 'assistant') + 1).flatMap(row => row.texts)
  if (!isQuietInput(texts)) return yield* next(e)
  yield { kind: 'text', index: 0, text: QUIET_LINE }
  yield { kind: 'stop', stopReason: 'end_turn', usage: null }
  return { turnId: e.turnId, index: e.index, answer: QUIET_LINE, toolUses: [], stopReason: 'end_turn', usage: null }
}
