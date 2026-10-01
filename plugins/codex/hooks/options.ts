// A codex agent's prompt may open with `model: <id>` and `effort: <level>`
// lines, since the Agent tool's own model option names Claude models only.
// They choose what Codex runs with and are not part of the task.

export type Options = { model?: string; effort?: string; prompt: string }

const LINE = /^(model|effort):\s*([A-Za-z0-9._-]+)\s*$/i

export function optionsOf(text: string): Options {
  const options: Options = { prompt: text }
  const lines = text.split('\n')
  let used = 0
  for (const line of lines) {
    const match = LINE.exec(line.trim())
    if (!match) break
    const key = match[1]!.toLowerCase() as 'model' | 'effort'
    options[key] = match[2]
    used++
  }
  options.prompt = lines.slice(used).join('\n').trim()
  return options
}

// `codex exec` config overrides for the chosen options.
export function overridesOf(options: Options): string[] {
  const out: string[] = []
  if (options.model) out.push('-c', `model="${options.model}"`)
  if (options.effort) out.push('-c', `model_reasoning_effort="${options.effort}"`)
  return out
}
