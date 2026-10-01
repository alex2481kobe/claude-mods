# codex

OpenAI Codex as a native Claude Code subagent.

![Two Codex agents on different models in Claude Code's agent list](media/agent-list.png)

Claude starts Codex with the Agent tool, the same way it starts any other
subagent, and Codex behaves like one:

- it shows in the agent list with its model and effort (`· Sol 6.1 (xhigh)`),
  its running time and token count, and clears when it finishes
- its row's activity line updates as Codex works, and Enter opens its view,
  where Codex's steps appear live and you can message it
- it runs in the background, and its report comes back to Claude
- you can message it, while it runs (`· 2 queued`) or after it finishes; each
  message resumes the same Codex session
- stopping the agent stops Codex

No Claude model runs inside the agent: the mod runs `codex exec` in its place
and streams what Codex does into the agent's transcript. (A small Claude model
stands in only if the mod itself fails, to report that failure.)

| Agent type    | Codex sandbox     | Use it for                                      |
| ------------- | ----------------- | ----------------------------------------------- |
| `codex:read`  | `read-only`       | second opinions, review, research, scoping      |
| `codex:write` | `workspace-write` | bounded implementation in the working directory |

## Requirements

- Claude Code with mods (tested on 2.1.287)
- The [Codex CLI](https://github.com/openai/codex), installed and logged in:

  ```sh
  npm install -g @openai/codex
  codex login
  ```

  `codex` must be on the `PATH` Claude Code starts with.

## Install

```
/plugin marketplace add alex2481kobe/claude-mods
/plugin install codex@claude-mods
```

## Use

Ask Claude for it by name:

> Have codex:read review the changes in src/auth and report anything risky.

> Use codex:write to add input validation to parseConfig in src/config.ts.

Codex cannot see your conversation with Claude, so Claude passes it a
self-contained prompt. Codex uses your own Codex login, model and config.

### Choosing a model

The Agent tool's own `model` option names Claude models, so a Codex model is
chosen in the prompt instead. Claude starts it with a `model:` and/or `effort:`
line, which the mod passes to Codex and removes from the task:

```
model: gpt-6-astra
effort: high
Review app.js for bugs and report back.
```

The agent types' descriptions list the models your Codex knows, so you can ask
in plain words: "have Codex review this on gpt-6-astra and gpt-6.1-sol".

## How it works

- The mod registers the two agent types.
- When a `codex:*` agent's loop asks its model for a response, the mod answers
  instead: it runs `codex exec --json -s <sandbox>` (approvals off, so the
  sandbox is the limit) in the session's working directory, appends Codex's
  messages and commands to the agent's conversation as they happen, and
  reports Codex's token usage on the agent's row.
- Codex's final message goes back as the agent's report: through the
  `SubagentHandback` tool in an interactive session, or as the final text where
  that tool does not exist (headless, SDK).
- Every message sent to the agent is passed to Codex once, resuming the same
  session with `codex exec resume`.

## Limits

- The Agent tool's `model` and `cwd` options are ignored: Codex uses your Codex
  config, in the session's working directory.
- What Codex may do is decided by its sandbox, not by Claude Code's permission
  prompts. In auto mode, Claude may note that its safety check could not review
  the agent's output, since no Claude model wrote it.
- Tested on macOS. Linux should behave the same; Windows is untested.
- The mods API is early access and may change between Claude Code releases.

## Develop

```sh
claude plugin validate plugins/codex
claude plugin test plugins/codex
claude --plugin-dir plugins/codex
```
