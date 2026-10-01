import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TurnStats } from '../types'

// One card per prompt row, keyed by the row's transcript id. The in-flight
// turn is state too, so a hot reload mid-turn does not lose its prompt.
const byPrompt = atom({ plugin: 'turn-card', key: 'byPrompt' } as const, {})
const current = atom({ plugin: 'turn-card', key: 'current' } as const, null)

// A no-break space: drawn as a blank cell that overwrites what is under the
// card, so the card is solid in the terminal's own background color.
const BLANK = '\u00a0'

const cardLines = (stats: TurnStats): string[] => {
  const lines = [
    `${stats.seconds}s  ${stats.tools} tool ${stats.tools === 1 ? 'call' : 'calls'}  ${stats.outputTokens} out tokens`,
    stats.model,
  ]
  const width = Math.max(...lines.map(line => line.length))
  return lines.map(line => BLANK + line + BLANK.repeat(width - line.length + 1))
}

export const register: Register = on => {
  on('session.append', async ($, e, next) => {
    // Only the person's own prompts start a card: a peer message or a task
    // notification folded into a running turn must not take it over.
    if (e.door === 'prompt' && e.agentId === undefined && e.origin.kind === 'composer') {
      const promptId = e.uuid
      await update($, current, () => ({ promptId, tools: 0 })).catch(err => $.ui.log(`turn-card: could not start a turn: ${err}`))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, current, turn => (turn === null ? null : { ...turn, tools: turn.tools + 1 })).catch(err => $.ui.log(`turn-card: could not count a tool call: ${err}`))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    const turn = await read($, current).catch(() => null)
    if (turn === null) return result

    const stats: TurnStats = {
      seconds: Math.round(e.durationMs / 1000),
      tools: turn.tools,
      outputTokens: e.usage?.output_tokens ?? 0,
      model: e.usage?.model ?? '',
    }
    await update($, byPrompt, all => ({ ...all, [turn.promptId]: stats })).catch(err => $.ui.log(`turn-card: could not keep stats: ${err}`))
    await update($, current, () => null).catch(err => $.ui.log(`turn-card: could not end a turn: ${err}`))
    return result
  })

  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'composer' } } }, async ($, e, next) => {
    const stats = (await read($, byPrompt))[e.requestId]
    if (stats === undefined || e.props.isExpanded) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const lines = cardLines(stats)

    // The card is absolute: it paints over the rows above this prompt without
    // moving anything, and shows only while the pointer is on the row.
    return (
      <Box key="row" flexDirection="column">
        {await next(e)}
        <Box
          position="absolute"
          top={-(lines.length + 2)}
          right={0}
          display="none"
          hover={{ display: 'flex' }}
          flexDirection="column"
          borderStyle="round"
          borderDimColor
        >
          {lines.map(line => (
            <Text dimColor wrap="truncate">
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
