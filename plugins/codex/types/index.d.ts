// What each running codex agent is doing, by agent id.
export type CodexDoing = { label: string; doing: string }

declare module 'claude-code' {
  interface PluginState {
    codex: { activity: Record<string, CodexDoing> }
  }
}
