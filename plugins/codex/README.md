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
- when Codex asks for an approval or an answer, the agent reports the question
  and its next message answers it, in the same paused Codex turn
- stopping the agent stops Codex

No Claude model runs inside the agent: the mod drives `codex app-server` in its
place and streams what Codex does into the agent's transcript. (A small Claude
model stands in only if the mod itself fails, to report that failure.)

| Agent type    | Shown as                | Codex sandbox and approvals            | Use it for                                      |
| ------------- | ----------------------- | -------------------------------------- | ----------------------------------------------- |
| `codex:read`  | `Codex read-only`       | `read-only`, approvals off             | second opinions, review, research, scoping      |
| `codex:write` | `Codex workspace-write` | `workspace-write`, approvals off       | bounded implementation in the working directory |
| `codex:run`   | `Codex`                 | your Codex config, changed by flags    | anything else Codex can be set up to do         |

## Requirements

- Claude Code with mods (tested on 2.1.287)
- macOS or Linux (the mod talks to Codex through a named pipe)
- The [Codex CLI](https://github.com/openai/codex) with `codex app-server`
  (tested on 0.159), installed and logged in:

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

### Choosing a model and settings

The Agent tool's own `model` option names Claude models, so Codex is set up in
the prompt instead. The prompt may open with Codex CLI flags, one per line,
spelled as `codex exec --help` spells them (`model: gpt-6-astra`,
`--sandbox workspace-write`, or a flag alone on its line). The mod passes them
to Codex and removes them from the task:

```
model: gpt-6-astra
effort: high
Review app.js for bugs and report back.
```

The agent types' descriptions list the models your Codex knows, so you can ask
in plain words: "have Codex review this on gpt-6-astra and gpt-6.1-sol".

`codex:read` and `codex:write` take `model`, `effort` and the flags that leave
their sandbox alone. `codex:run` takes every flag that applies to a session the
mod drives:

| Flag                                                      | What Codex gets                                         |
| --------------------------------------------------------- | ------------------------------------------------------- |
| `model`, `effort`                                         | `model`, `model_reasoning_effort`                       |
| `sandbox` (`s`)                                           | `sandbox_mode`                                          |
| `ask-for-approval` (`a`)                                  | `approval_policy`                                       |
| `approve-for-me`                                          | the automatic reviewer, in `workspace-write`            |
| `dangerously-bypass-approvals-and-sandbox`                | `danger-full-access` with approvals off                 |
| `add-dir`                                                 | an extra writable root, beside your config's            |
| `search`, `local-provider`, `cd` (`C`), `image` (`i`)     | live web search, the model provider, the folder, images |
| `config` (`c`), `enable`, `disable`, `strict-config`      | passed as given                                         |
| `ephemeral`, `output-schema`                              | an unsaved session, a JSON Schema for the answer        |

Everything left out comes from your Codex config. A flag `codex app-server` has no use for (`profile`,
`worktree`, `json`, ...) stops the run with the reason rather than being
dropped.

### Answering Codex

When Codex asks for something, the agent hands the question back:

```
Codex asks to run:
  printf 'hi' > note.txt
in /path/to/project
Reason: requires approval by policy
Reply "approve", "approve for session", "decline", or "cancel" (decline and stop the turn).
```

Claude answers it itself or asks you, then sends the reply to the agent as a
message, and Codex carries on in the same turn. Questions for the user and MCP
servers' forms work the same way.

Who Codex asks is set by its config. With `approvals_reviewer` set to Codex's
automatic reviewer, Codex never asks: its reviewer decides, and the transcript
shows what it decided. To be asked instead, set approvals to come to you, in
your config or for one agent:

```
ask-for-approval: on-request
config: approvals_reviewer="user"
Create note.txt containing hi.
```

## How it works

- The mod registers the three agent types.
- When a `codex:*` agent's loop asks its model for a response, the mod answers
  instead: it starts `codex app-server` with the agent's flags as config
  overrides, starts or resumes the Codex session in the session's working
  directory, appends Codex's messages and commands to the agent's
  conversation as they happen, and reports Codex's token usage on the agent's
  row.
- A mod's process takes its input once, so the mod writes to `codex app-server`
  through a named pipe in a private temporary folder, which goes when the
  process does.
- Codex's final message, or its question, goes back as the agent's report:
  through the `SubagentHandback` tool in an interactive session, or as the
  final text where that tool does not exist (headless, SDK).
- Codex runs only while it works or waits on a question. Every message sent to
  the agent is passed to Codex once, as it was sent: as the answer to a waiting
  question, or as a new turn of the same Codex session.

## Limits

- The Agent tool's `model` and `cwd` options are ignored: Codex uses your Codex
  config, in the session's working directory.
- What Codex may do is decided by its sandbox, approvals and requirements, not
  by Claude Code's permission prompts. `codex:run` takes every flag Codex
  accepts, `dangerously-bypass-approvals-and-sandbox` included. Codex's own
  requirements (`allowed_sandbox_modes`, `allowed_approval_policies`) are the
  place to forbid one; the mod has not been tested against them. In auto mode, Claude may note that its safety
  check could not review the agent's output, since no Claude model wrote it.
- `codex app-server` takes no profiles: set those values with `config:` lines.
- A question left unanswered keeps that Codex waiting until it is answered or
  the session ends.
- Tested on macOS. Linux should behave the same; Windows is not supported.
- The mods API is early access and may change between Claude Code releases.

## Develop

```sh
claude plugin validate plugins/codex
claude plugin test plugins/codex
claude --plugin-dir plugins/codex
```
