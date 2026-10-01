import type { AgentSpec } from 'claude-code'

import { FLAG_NAMES, type Pin } from './flags'

// The three codex agent types: what each pins, how it is shown, and how it
// is offered to the model.

export const TYPES: Record<string, { pin?: Pin; shown: string }> = {
  'codex:read': { pin: { sandbox: 'read-only' }, shown: 'Codex read-only' },
  'codex:write': { pin: { sandbox: 'workspace-write' }, shown: 'Codex workspace-write' },
  'codex:run': { shown: 'Codex' },
}

// Only reached if the turn.step hook fails, so the failure is not mistaken
// for an answer.
const FALLBACK = `You stand in for Codex, which failed to start. Report exactly "codex mod: the run failed to start; see this agent's transcript and the debug log." as your final report, and do nothing else.`

const CHOOSING = (models: string[]) =>
  ` Codex CLI flags may open the prompt, one per line as \`codex exec --help\` names them without dashes (\`model: <id>\`, \`effort: <level>\`` +
  (models.length > 0 ? `; models: ${models.join(', ')}` : '') +
  `); left out, Codex uses its own config. When Codex asks for an approval or an answer, the agent reports the question; send it the reply as a message.`

// The agent types as `$.agent.register` takes them, offering these models.
export function specsOf(models: string[]): AgentSpec[] {
  const common = { prompt: FALLBACK, tools: ['Read'], model: 'haiku', omitClaudeMd: true } as const
  const choosing = CHOOSING(models)
  return [
    {
      ...common,
      name: 'read',
      description:
        'OpenAI Codex in a read-only sandbox: a second opinion, review, research or scoping by a different model. Give it a self-contained prompt; it cannot see this conversation.' + choosing,
    },
    {
      ...common,
      name: 'write',
      description:
        'OpenAI Codex with workspace-write in the working directory: bounded implementation by a different model. Give it a self-contained prompt naming the files it owns; it cannot see this conversation.' + choosing,
    },
    {
      ...common,
      name: 'run',
      description:
        `OpenAI Codex as your Codex config sets it up (sandbox, approvals, reviewer), changed per call by any of its flags: ${FLAG_NAMES.join(', ')}. Give it a self-contained prompt; it cannot see this conversation.` + choosing,
    },
  ]
}
