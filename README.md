# claude-mods

Mods for [Claude Code](https://code.claude.com/docs/en/plugins/mods/overview).

## codex

OpenAI Codex as a native Claude Code subagent.

Claude starts Codex with the Agent tool, the same way it starts any other
subagent. Codex shows up in the task list, runs in the background, and its
answer comes back to Claude. You can message it to follow up. No Claude model
runs inside the agent: the mod runs `codex exec` in its place and streams what
Codex does into the agent's transcript, and the agent's spinner and the status
line say what Codex is doing right now. (A small Claude model stands in only if
the mod itself fails, to report that failure.)

| Agent type    | Codex sandbox     | Use it for                                  |
| ------------- | ----------------- | ------------------------------------------- |
| `codex:read`  | `read-only`       | second opinions, review, research, scoping  |
| `codex:write` | `workspace-write` | bounded implementation in the working directory |

### Requirements

- Claude Code with mods (tested on 2.1.287)
- The [Codex CLI](https://github.com/openai/codex), installed and logged in:

  ```sh
  npm install -g @openai/codex
  codex login
  ```

  `codex` must be on the `PATH` Claude Code starts with.

### Install

In Claude Code:

```
/plugin marketplace add alex2481kobe/claude-mods
/plugin install codex@claude-mods
```

Or from a shell:

```sh
claude plugin marketplace add alex2481kobe/claude-mods
claude plugin install codex@claude-mods
```

### Use

Ask Claude for it by name:

> Have codex:read review the changes in src/auth and report anything risky.

> Use codex:write to add input validation to parseConfig in src/config.ts.

Codex cannot see your conversation with Claude, so Claude passes it a
self-contained prompt. Codex uses your own Codex login, model and config; the
agent's label and transcript show the model your `config.toml` names.

### How it works

The mod registers the two agent types. When a `codex:*` agent's loop asks its
model for a response, the mod answers instead: it runs
`codex exec --json -s <sandbox>` (approvals off, so the sandbox is the limit)
with the agent's prompt in the session's working
directory, streams Codex's messages and commands into the agent's transcript,
and hands Codex's final message back as the agent's report. A follow-up message
resumes the same Codex session with `codex exec resume`. Stopping the agent stops
Codex.

### Limits

- The Agent tool's `model` and `cwd` options are ignored: Codex uses your Codex
  config, in the session's working directory.
- What Codex may do is decided by its sandbox, not by Claude Code's permission
  prompts.
- Tested on macOS. Linux should behave the same; Windows is untested.
- The mods API is early access and may change between Claude Code releases.

### Choosing a model

The Agent tool's own `model` option names Claude models, so a Codex model is
chosen in the prompt instead. Claude starts it with a `model:` and/or `effort:`
line, which the mod passes to Codex and removes from the task:

```
model: gpt-6-astra
effort: high
Review app.js for bugs and report back.
```

The agent types' descriptions list the models your Codex knows, so you can
ask in plain words: "have Codex review this on gpt-6-astra and gpt-6.1-sol".

### Develop

```sh
claude plugin validate plugins/codex
claude plugin test plugins/codex
claude --plugin-dir plugins/codex
```

## agent-models

A band above the prompt that lists each subagent with the model and effort its
requests actually go out with, instead of only its agent type. Codex agents
show their Codex model.

```
/plugin install agent-models@claude-mods
```

## License

Apache-2.0
