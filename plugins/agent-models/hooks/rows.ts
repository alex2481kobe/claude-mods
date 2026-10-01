import type { AgentRow } from '../types'

// The band's rows: one per subagent of the session, newest last.

const KEEP = 20

// Adds the row or merges into the one with its id.
export function upsert(rows: readonly AgentRow[], id: string, patch: Partial<AgentRow>): AgentRow[] {
  const found = rows.find(r => r.id === id)
  if (!found) {
    if (!patch.type) return [...rows]
    const row: AgentRow = { id, label: '', status: 'running', ...patch, type: patch.type }
    return [...rows, row].slice(-KEEP)
  }
  return rows.map(r => (r.id === id ? { ...r, ...patch } : r))
}

export type Line = { mark: string; type: string; model: string; label: string; isRunning: boolean }

// A subagent run by another program (the codex mod) names its model in its
// label after ` · codex `; its steps' model is only the stand-in's.
const ELSEWHERE = / · codex (.+)$/

export function lineOf(row: AgentRow): Line {
  const elsewhere = ELSEWHERE.exec(row.label)
  const label = elsewhere ? row.label.slice(0, elsewhere.index) : row.label
  const model = elsewhere
    ? elsewhere[1]!
    : row.model
      ? row.effort
        ? `${row.model} (${row.effort})`
        : row.model
      : 'model pending'
  const mark = { running: '●', done: '✓', stopped: '■', failed: '✗' }[row.status]
  return { mark, type: row.type, model, label, isRunning: row.status === 'running' }
}

// Running rows first, then the most recent finished ones, at most `room`.
export function shown(rows: readonly AgentRow[], room: number): AgentRow[] {
  const running = rows.filter(r => r.status === 'running')
  const finished = rows.filter(r => r.status !== 'running')
  return [...running, ...finished.slice(-Math.max(0, room - running.length))].slice(0, room)
}
