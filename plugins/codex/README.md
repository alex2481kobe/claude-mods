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
- you can message it, while it runs or after it finishes; each message
  resumes the same Codex session. A message Claude sends while Codex works
  joins Codex's running turn, so Codex reads it then and its answer covers it;
  one you type in the agent's view waits for the turn to end (`· 1 queued`)
- when Codex asks for an approval or an answer, the agent reports the question
  and its next message answers it, in the same paused Codex turn
- in its view, `/codex-*` commands change its model, effort, sandbox and
  approvals for its next Codex turns and show its status
- stopping the agent stops Codex, and so does Claude Code exiting or crashing

No Claude model runs inside the agent: the mod drives `codex app-server` in its
place and shows what Codex does in the agent's view as it happens. (A small Claude
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
to Codex and removes them from the task. `Model:` and `Effort:` may be written
in any case:

```
model: gpt-6-astra
effort: high
Review app.js for bugs and report back.
```

The agent types' descriptions list the models your Codex knows, so you can ask
in plain words: "have Codex review this on gpt-6-astra and gpt-6.1-sol".

Only an exact option line is an option: a flag's name with one plain value (a
path, or a config `key=value`, may hold spaces), or a flag that takes no value
alone on its line. The first line that is not one starts the task, so a prompt
that opens with prose such as `search: every call to fetch` or `color: change
the header color` is passed to Codex whole.

`codex:read` and `codex:write` take `model`, `effort` and the flags that leave
their sandbox alone; `sandbox`, approvals, `add-dir` and `cd` are refused there.
`codex:run` takes every flag that applies to a session the mod drives:

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

Everything left out comes from your Codex config. An option line for a flag
`codex app-server` has no use for (`profile: fast`, `worktree`, `json`, ...)
stops the run with the reason rather than being dropped.

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

A question lives as long as the Codex that asked it. If that Codex is gone
(it exited, the session was resumed, or the mod reloaded), a reply such as
"approve" is not sent as a new task: the agent reports that the question has
expired, and the task has to be sent again.

Who Codex asks is set by its config. With `approvals_reviewer` set to Codex's
automatic reviewer, Codex never asks: its reviewer decides, and the transcript
shows what it decided. To be asked instead, set approvals to come to you, in
your config or for one agent:

```
ask-for-approval: on-request
config: approvals_reviewer="user"
Create note.txt containing hi.
```

### Commands in the agent's view

Open a codex agent's view (select it in the agent list, press Enter) and run
a command; the `/` menu there lists them. The reply shows above the prompt in
that view, and neither Codex nor Claude is sent it:

| Command                                                      | What it does                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| `/codex-model <id>`                                          | the Codex model, from the agent's next Codex turn             |
| `/codex-effort <level>`                                      | the reasoning effort, from the next turn                      |
| `/codex-sandbox <read-only\|workspace-write\|danger-full-access>` | the sandbox, from the next turn                         |
| `/codex-approvals <untrusted\|on-request\|never>`            | when Codex asks for approval, from the next turn              |
| `/codex-status`                                              | what Codex said the session ran with at its last turn, what changes next turn, the Codex session and its tokens |
| `/codex-help`                                                | the list                                                      |

```
model     gpt-6-astra from the next Codex turn (now gpt-6-luna)
effort    low
sandbox   workspace-write
approvals on-request
session   01a0f9f0-0000-7000-8000-000000000000
tokens    141,551 in (127,488 cached), 296 out
```

A setting is kept for that agent and goes with each of its later Codex turns,
and the header of each turn names the model and effort Codex reports for it.
Values follow the option rules above: `codex:read` and `codex:write` refuse
`/codex-sandbox` and `/codex-approvals`, since they pin their sandbox, and a
value that is not one plain word is refused. An unknown `/codex-` command, or
one without its value, answers with the list. Claude can send one to the
agent with SendMessage; then the reply is the agent's report, and a message
sent together with it goes to Codex on its own.

While a codex agent's view is open, the footer and the `/` menu list these
commands alone: Claude Code's own commands act on the main session, not on
the agent, so they are hidden there (typed in full, they still run). Elsewhere
the `/codex-` commands are hidden, and one typed in full says to open a codex
agent's view.

## How it works

- The mod registers the three agent types.
- When a `codex:*` agent's loop asks its model for a response, the mod answers
  instead: it starts `codex app-server` with the agent's flags as config
  overrides, starts or resumes the Codex session in the session's working
  directory with the settings its commands chose, shows Codex's messages and commands in the agent's view as they
  happen (each is also appended as a notice, which is what refreshes the agent
  list's activity line; the detailed transcript, ctrl+o, shows both), and
  reports Codex's token usage on the agent's row.
- A mod's process takes its input once, so the mod writes to `codex app-server`
  through a named pipe in a private temporary folder, which goes when the
  process does. The mod writes only to that pipe, and never once the server
  has gone.
- Codex runs in a process group of its own under a small shell. Stopping the
  agent ends the shell and Codex with it; if Claude Code exits without stopping
  it (a crash, `kill -9`), the shell sees its parent gone within a second or
  two and ends Codex and the folder.
- Codex's final message, or its question, goes back as the agent's report:
  through the `SubagentHandback` tool in an interactive session, or as the
  final text where that tool does not exist (headless, SDK). A handback you
  interrupt (Esc in the agent's view) does not change that; the report it
  carried is handed back again the next time the agent's loop runs.
- A step interrupted before Codex finished (Esc) passes nothing on: Codex is
  stopped, and the next time the agent's loop runs, the message is given to
  Codex again. The agent's options come from the prompt it was spawned with,
  which the mod records at spawn, so a first task run again keeps them
  however Claude Code places the messages sent since; the task goes first,
  then those messages. Claude Code's interruption marker
  (`[Request interrupted by user]`) never reaches Codex. When the interruption is the session moving to the background
  (the session list opening while the agent's first turn runs), Claude Code
  2.1.287 continues the agent in a forked session whose conversation, as the
  mod reads it, no longer holds the task, so the agent reports
  `codex: nothing new to send to Codex.` and Claude has to send the task
  again.
- Codex runs only while it works or waits on a question. Every message sent to
  the agent is passed to Codex once, in the sender's own words: as the answer
  to a waiting question, added to Codex's running turn (`turn/steer`, for a
  message Claude sends with SendMessage while Codex works), or as a new turn
  of the same Codex session. Claude
  Code places a message sent to a running agent twice, wrapped in its own
  instructions and as typed; the mod counts it once and drops the wrapping, so
  the same words sent twice are asked twice. A `/codex-` message is the mod's
  own and never reaches Codex.

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
- `codex:read` and `codex:write` run with approvals off, so the sandbox is the
  limit. Codex's `workspace-write` sandbox keeps `.git` read-only, so
  `codex:write` cannot stage or commit (`git add` fails on `.git/index.lock`);
  commit its work yourself, or use `codex:run` with approvals that let Codex
  ask.
- A question left unanswered keeps that Codex waiting until it is answered or
  the session ends.
- An agent started with `ephemeral` cannot take follow-ups: Codex does not
  keep its session, so there is nothing to resume.
- Claude Code 2.1.287 shows a mod a message typed in an agent's view only
  once the agent's turn has ended, so such a message cannot join Codex's
  running turn; it waits for Codex's current task, then runs as its next turn.
- A command's reply shows above the prompt only while that view stays open,
  and goes when the view closes or the mod reloads.
- What the agent answers also reaches Claude as
  the agent's report, and Claude reads a message typed in the view as one the
  agent got.
- Claude Code may run the agent's loop again for the copy of a message it
  places later. Codex is not asked again, but the loop has to report, so
  Claude gets the one line `codex: nothing new to send to Codex.`, and the
  view shows `codex: nothing to run.` (Ending without a report would have
  Claude Code tell Claude that no report came and to message the agent for
  one.)
- Opening the session list (← from the prompt) moves the conversation into a
  background process. On macOS Claude Code 2.1.287 sometimes starts that
  process as the Claude Code app itself, which macOS checks on its own for
  access to Documents, Desktop and Downloads. If the plugin's folder is under
  one of those and Claude Code has not been given access, that process cannot
  read the plugin, so the conversation continues there without it: the codex
  agent types are gone until you restart. A plugin installed from the
  marketplace lives under `~/.claude` and is not affected; for a
  `--plugin-dir` or a local marketplace, keep the folder outside those three.
- Claude Code's task list (`/tasks`) names the stand-in's model, Haiku, for a
  codex agent; the agent's row and header show Codex's. The agent keeps a
  Claude model so that a run the mod does not answer (the mod not loaded, or
  the session resumed without it) reaches the stand-in, which reports that
  Codex did not run, rather than failing on a Codex model id.
- Tested on macOS with codex-cli 0.159 and Claude Code 2.1.287, in an
  interactive terminal session (agent list, agent view and its commands,
  footer and `/` menu, background agents, messages and queued messages,
  approvals, stop) and headless (`claude -p`). Linux should behave
  the same; Windows is not supported (the mod needs `sh` and a named pipe).
- The mods API is early access and may change between Claude Code releases.

## Develop

```sh
claude plugin validate plugins/codex
claude plugin test plugins/codex
claude --plugin-dir plugins/codex
```
