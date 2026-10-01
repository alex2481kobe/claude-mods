import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { lineOf, shown, upsert } from './rows'

// Shows every subagent above the prompt with the model and effort its
// requests actually go out with, instead of only its agent type.

const agents = atom({ plugin: 'agent-models', key: 'agents' } as const, [])

const ROOM = 6

export const register: Register = on => {
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = started.agentId
    if (id) {
      const info = (await $.agent.list()).find(a => a.id === id)
      const label = info?.description ?? e.description
      await update($, agents, rows => upsert(rows, id, { type: e.subagentType, label, status: 'running' }))
    }
    return started
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id) {
      const effort = e.effort === undefined ? undefined : String(e.effort)
      await update($, agents, rows => upsert(rows, id, { model: e.model, effort, status: 'running' }))
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const status = e.reason === 'aborted' ? 'stopped' : e.reason === 'answer' ? 'done' : 'failed'
      await update($, agents, rows => upsert(rows, id, { status }))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rows = shown(await read($, agents), Math.min(ROOM, e.props.maxRows))
    if (e.props.hasSurvey || rows.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rows.map(row => {
          const line = lineOf(row)
          return (
            <Text wrap="truncate-end" dimColor={!line.isRunning}>
              <Text color={line.isRunning ? 'green' : undefined}>{line.mark}</Text> <Text bold>{line.type}</Text>{' '}
              <Text color="cyan">{line.model}</Text> <Text dimColor>{line.label}</Text>
            </Text>
          )
        })}
      </Box>
    )
  })
}
