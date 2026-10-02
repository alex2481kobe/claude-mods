// The messages each codex agent has passed to Codex, by agent id.
export type CodexSent = Record<string, string[]>

// The prompt each codex agent was spawned with, by agent id.
export type CodexOpenings = Record<string, string>

// A Codex CLI option a codex agent's `/codex-*` commands set, as its option
// line names it.
export type CodexOptionName = 'model' | 'effort' | 'sandbox' | 'ask-for-approval'

// What each codex agent's commands set, by agent id; each applies from the
// agent's next Codex turn.
export type CodexOptions = Record<string, Partial<Record<CodexOptionName, string>>>

// What Codex reported a codex agent's session runs with, at its last turn:
// the session, model, reasoning effort, sandbox and approval policy, and the
// session's token total.
export type CodexRun = {
  threadId: string
  model: string
  effort: string | null
  sandbox: string
  approvals: string
  tokens: { input: number; cached: number; output: number }
}

export type CodexRuns = Record<string, CodexRun>

declare module 'claude-code' {
  interface PluginState {
    codex: { sent: CodexSent; openings: CodexOpenings; options: CodexOptions; runs: CodexRuns }
  }
}
