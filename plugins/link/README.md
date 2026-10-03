# link

Click a file path in a reply and Finder opens with it selected.

Claude Code prints file paths as plain text. With this mod, a path in a
reply that exists on disk becomes a link: pressing it shows a file selected in
its folder in Finder, or opens a folder as itself, and a toast says which.

## Requirements

- Claude Code with mods, in the terminal (the reply is only changed there)
- macOS: it runs `open` and `open -R`
- A terminal with hyperlinks (OSC 8), such as Ghostty or iTerm2. Apple
  Terminal has none: there Claude Code writes each link's `file://` address
  after it, so a path shows twice, and pressing it does not always open it

## Install

```
/plugin marketplace add alex2481kobe/claude-mods
/plugin install link@claude-mods
```

## How it works

- A `ui.render` hook on assistant messages finds path-like text, resolves it
  against the session's folder and home, and keeps only paths that exist.
- Those paths are turned into `file://` links in the reply's Markdown. A
  folder's URL ends in a slash, which is how a press tells it from a file.
- Pressing a link runs `open -R <file>` or `open <folder>` and toasts the
  result, or the error if it failed.
- A reply longer than 10000 characters, or with no existing path, keeps the
  engine's own drawing.
