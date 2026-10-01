// Codex model ids as people say them: `gpt-6.1-sol` reads `Sol 6.1`. An id
// of another shape is shown as it is.
export function nameOf(id: string): string {
  const match = /^gpt-([\d.]+)-([a-z]+)$/i.exec(id)
  if (!match) return id
  const name = match[2]!
  return `${name[0]!.toUpperCase()}${name.slice(1)} ${match[1]}`
}
