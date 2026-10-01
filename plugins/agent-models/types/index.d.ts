export type AgentRow = {
  id: string
  type: string
  label: string
  model?: string
  effort?: string
  status: 'running' | 'done' | 'stopped' | 'failed'
}

declare module 'claude-code' {
  interface PluginState {
    'agent-models': { agents: AgentRow[] }
  }
}
