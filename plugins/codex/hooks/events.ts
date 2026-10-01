// Reads what `codex app-server` reports while a turn runs. Each notification
// becomes a line of progress for the agent's transcript, the run's answer is
// its last agent message, and its usage is what the turn cost.

import type { ModelUsage } from 'claude-code'

export type Run = {
  threadId?: string
  answer?: string
  error?: string
  usage?: ModelUsage
  isDone?: boolean
  // The thread's token total before this turn's first request.
  before?: ModelUsage
}

// Codex counts cached tokens inside `inputTokens`; the engine's shape counts
// them apart, as the Messages API does.
export function usageOf(usage: any): ModelUsage {
  const cached = Number(usage?.cachedInputTokens) || 0
  return {
    input_tokens: Math.max(0, (Number(usage?.inputTokens) || 0) - cached),
    output_tokens: Number(usage?.outputTokens) || 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: Number(usage?.cacheWriteInputTokens) || 0,
  }
}

function minus(a: ModelUsage, b: ModelUsage): ModelUsage {
  return {
    input_tokens: Math.max(0, a.input_tokens - b.input_tokens),
    output_tokens: Math.max(0, a.output_tokens - b.output_tokens),
    cache_read_input_tokens: Math.max(0, (a.cache_read_input_tokens ?? 0) - (b.cache_read_input_tokens ?? 0)),
    cache_creation_input_tokens: Math.max(0, (a.cache_creation_input_tokens ?? 0) - (b.cache_creation_input_tokens ?? 0)),
  }
}

// Splits streamed text into complete lines, keeping the unfinished tail.
export function lines(buffer: string, text: string): { done: string[]; rest: string } {
  const parts = (buffer + text).split('\n')
  return { done: parts.slice(0, -1), rest: parts.at(-1) ?? '' }
}

// `/bin/zsh -lc 'cat go.mod'` reads `cat go.mod`.
export function commandOf(command: string): string {
  return /^\S*sh -lc (['"])(.*)\1$/s.exec(command)?.[2] ?? command
}

// Folds one notification into the run and returns the progress it shows.
// Notifications of another thread (none, while the mod runs one) are not
// this run's.
export function apply(run: Run, method: string, params: any): string | undefined {
  if (params?.threadId && run.threadId && params.threadId !== run.threadId) return undefined
  const item = params?.item
  switch (method) {
    case 'item/started':
      return item?.type === 'commandExecution' ? `$ ${commandOf(item.command)}\n` : undefined
    case 'item/completed':
      if (item?.type === 'agentMessage') {
        run.answer = item.text
        return `${item.text.trimEnd()}\n\n`
      }
      if (item?.type === 'commandExecution') return item.exitCode ? `  exit ${item.exitCode}\n` : undefined
      if (item?.type === 'fileChange') return `edited ${(item.changes ?? []).map((c: any) => c.path).join(', ')}\n`
      if (item?.type === 'webSearch') return `searched the web: ${item.query}\n`
      if (item?.type === 'mcpToolCall') return `${item.server}.${item.tool}${item.error ? ' failed' : ''}\n`
      return undefined
    case 'guardianWarning':
      return `auto review: ${params.message}\n`
    case 'thread/tokenUsage/updated': {
      // The thread's running total, less what it held before this turn.
      const total = usageOf(params.tokenUsage?.total)
      run.before ??= minus(total, usageOf(params.tokenUsage?.last))
      run.usage = minus(total, run.before)
      return undefined
    }
    case 'error':
      // A retried error is one Codex recovers from; the turn says how it ended.
      if (params.willRetry) return undefined
      run.error = params.error?.message
      return `error: ${run.error}\n`
    case 'turn/completed': {
      run.isDone = true
      const turn = params.turn
      if (turn?.status === 'completed') run.error = undefined
      else run.error = turn?.error?.message ?? run.error ?? `the turn ended ${turn?.status ?? 'without a status'}`
      return undefined
    }
    default:
      return undefined
  }
}
