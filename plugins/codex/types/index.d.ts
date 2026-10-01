// The messages each codex agent has passed to Codex, by agent id.
export type CodexSent = Record<string, string[]>

declare module 'claude-code' {
  interface PluginState {
    codex: { sent: CodexSent }
  }
}
