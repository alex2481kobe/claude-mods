export type TurnStats = { seconds: number; tools: number; outputTokens: number; model: string }

// The composer prompt the running main-loop turn answers, and its tool calls so far.
export type CurrentTurn = { promptId: string; tools: number }

declare module 'claude-code' {
  interface PluginState {
    'turn-card': { byPrompt: Record<string, TurnStats>; current: CurrentTurn | null }
  }
}
