# agent-models

Each Claude subagent's model and effort in Claude Code's agent list.

![Two Claude subagents in the agent list, labelled Opus 5.5 (high) and Haiku](media/agent-list.png)

Claude Code's agent list shows a subagent's task but not what it runs on. With
this mod each row carries it, the way the codex mod's rows do:

```
Review auth · Opus 5.5 (high)
Check label.ts · Sonnet 5.5 (medium)
Say ok · Haiku
```

| The agent                                           | Its label                                         |
| --------------------------------------------------- | ------------------------------------------------- |
| `general-purpose`, a fork, an agent file's `inherit` | the parent's model and effort                     |
| an agent file with `model:` (and `effort:`)          | that model, and that effort                       |
| the Agent tool's `model` option                      | that model; the parent's effort only if the same model |
| Explore, Plan and other built-ins                    | none: their model is the engine's to choose       |
| a plugin's agent (`codex:read`)                      | none: the plugin labels its own                   |

Where the model cannot be known before the agent starts, the row is left as it
was rather than guessed.

## Requirements

- Claude Code with mods (tested on 2.1.287)

## Install

```
/plugin marketplace add alex2481kobe/claude-mods
/plugin install agent-models@claude-mods
```

## How it works

- An `agent.spawn` hook, which runs before the subagent starts, appends
  ` · <model> (<effort>)` to the task's description; the agent list shows that
  description.
- The model is the Agent tool's `model` option, else the agent file's, else the
  parent's for the agents that inherit it. Agent files are read from the
  project's `.claude/agents/` and your own (`~/.claude/agents/`, or
  `$CLAUDE_CONFIG_DIR/agents/`), matched by their `name`.
- The effort is the agent file's `effort`, else the effort of the parent's
  latest request, and that only when the agent runs on the parent's own model:
  another model may take no effort at all (Haiku takes none).
- Model ids read as people say them: `claude-opus-5-5` is `Opus 5.5`.

## Limits

- An agent file in a subfolder of `agents/`, or one defined in settings, a
  flag or policy, is not read, so its agent goes unlabelled.
- An agent file with no `model:` line is left unlabelled.
- An alias reads as its name without a version: `haiku` is `Haiku`.
- An agent file's `effort` is shown even when the Agent tool's `model` option
  overrides its model.
- Tried in the interactive terminal and headless (`claude -p`).
- The mods API is early access and may change between Claude Code releases.

## Develop

```sh
claude plugin validate plugins/agent-models
claude plugin test plugins/agent-models
claude --plugin-dir plugins/agent-models
```
