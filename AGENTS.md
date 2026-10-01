# Working in claude-mods

A marketplace of Claude Code mods. Each plugin is self-contained under
`plugins/<name>/`; the repo root holds only the marketplace, the index README and
this file.

## Find a plugin

- `.claude-plugin/marketplace.json` lists every published plugin and its folder.
- `README.md` has one row per plugin linking to its own README.
- `plugins/<name>/README.md` is the plugin's full documentation: what it does,
  requirements, how it works, limits.

## Add a plugin

1. Create `plugins/<name>/` with `.claude-plugin/plugin.json`, `hooks/hooks.json`,
   the hooks module, `tests/`, and a `types/index.d.ts` contract if it keeps
   `$.state`.
2. Write `plugins/<name>/README.md` in the shape of the existing ones.
3. Add at least one real screenshot of it in use to `plugins/<name>/media/`.
4. Add its entry to `.claude-plugin/marketplace.json` and a row to `README.md`.

## Before a change lands

- `claude plugin validate plugins/<name>` passes, and `claude plugin validate .`
  for the marketplace.
- `claude plugin test plugins/<name>` passes, with a test that fails when the
  behaviour it covers is broken.
- The module type-checks against the Claude Code version it was tested on.
- It was run live in Claude Code; the README says which surfaces were tried.
- Bump the plugin's `version` so installs pick the change up.

## Rules

- A plugin touches only its own folder. Shared files (`marketplace.json`,
  `README.md`, this file) change in the same commit as the plugin they describe.
- This repo is public: no machine paths, usernames, tokens, or internal notes.
- No runtime dependencies: a mod's module imports only its own files.
- The mods API is the authority: the types Claude Code writes beside a loaded
  mod (`.claude-plugin/types/`), not third-party guides.
