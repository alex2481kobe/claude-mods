import type { RenderElement } from 'claude-code'

// The band above the prompt in a codex agent's view: the reply to the last
// /codex- command run there, over whatever the band holds beneath.
export function replyBand(ui: { Box: any; Text: any }, reply: string, below: RenderElement | null) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      <Text>{reply}</Text>
      {below}
    </Box>
  )
}
