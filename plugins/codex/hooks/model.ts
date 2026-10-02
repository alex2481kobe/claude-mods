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

// `Sol 6.1 (high)`: the chosen model and effort over the config's. With
// neither naming a model, Codex picks its own; which one is known only once
// Codex runs (each turn's header names it), so the label says so.
export function labelOf(config: Choice, options: Choice): string {
  const id = options.model ?? config.model
  const model = id ? nameOf(id) : 'Codex default'
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

// What reading Codex's own files needs of the engine: the environment
// variables that place them, and a file read.
export type Files = {
  env: { CODEX_HOME?: string; HOME?: string; USERPROFILE?: string }
  read: (path: string) => Promise<string>
}

async function readOr(files: Files, name: string): Promise<string> {
  const { CODEX_HOME, HOME, USERPROFILE } = files.env
  try {
    return await files.read(`${CODEX_HOME ?? `${HOME ?? USERPROFILE}/.codex`}/${name}`)
  } catch {
    return ''
  }
}

// The model and effort Codex's config.toml names; empty when it names none.
export async function codexConfig(files: Files): Promise<Choice> {
  return configOf(await readOr(files, 'config.toml'))
}

// The model ids Codex's model cache lists.
export async function codexModels(files: Files): Promise<string[]> {
  return modelsOf(await readOr(files, 'models_cache.json'))
}
