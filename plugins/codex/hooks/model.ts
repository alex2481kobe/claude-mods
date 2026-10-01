import { nameOf } from './names'

// What Codex runs with: its config.toml's top-level model and reasoning
// effort, under what a codex agent's prompt chose.

export type Choice = { model?: string; effort?: string }

export function configOf(toml: string): Choice {
  const choice: Choice = {}
  for (const line of toml.split('\n')) {
    const text = line.trim()
    if (text.startsWith('[')) break
    const pair = /^([A-Za-z_]+)\s*=\s*["']([^"']+)["']/.exec(text)
    if (pair?.[1] === 'model') choice.model = pair[2]
    if (pair?.[1] === 'model_reasoning_effort') choice.effort = pair[2]
  }
  return choice
}

// `Sol 6.1 (high)`: the chosen model and effort over the config's.
export function labelOf(config: Choice, options: Choice): string {
  const id = options.model ?? config.model
  const model = id ? nameOf(id) : 'default model'
  const effort = options.effort ?? config.effort
  return effort ? `${model} (${effort})` : model
}

// The model ids Codex's model cache lists, newest first as it keeps them;
// empty when the cache is missing or its shape is not the one read here.
export function modelsOf(json: string): string[] {
  try {
    const cache = JSON.parse(json)
    const list = Array.isArray(cache) ? cache : (cache?.models ?? cache?.data)
    if (!Array.isArray(list)) return []
    return list.map((m: any) => m?.slug ?? m?.id).filter((s: unknown): s is string => typeof s === 'string')
  } catch {
    return []
  }
}
