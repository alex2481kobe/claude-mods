// The model Codex runs with, as the top level of its config.toml names it,
// with the reasoning effort when one is set: `gpt-5 (high)`.
export function modelOf(toml: string): string | undefined {
  let model: string | undefined
  let effort: string | undefined
  for (const line of toml.split('\n')) {
    const text = line.trim()
    if (text.startsWith('[')) break
    const pair = /^([A-Za-z_]+)\s*=\s*["']([^"']+)["']/.exec(text)
    if (pair?.[1] === 'model') model = pair[2]
    if (pair?.[1] === 'model_reasoning_effort') effort = pair[2]
  }
  if (!model) return undefined
  return effort ? `${model} (${effort})` : model
}
