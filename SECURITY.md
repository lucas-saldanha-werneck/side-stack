# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Open the repository's
[Security tab](https://github.com/lucas-saldanha-werneck/side-stack/security) and choose
"Report a vulnerability" (GitHub private vulnerability reporting).

## Supported versions

Only the latest release is supported. Fixes land there.

## What this plugin accesses

- It runs inside Claude Code's mod host, opens its own side pane when a session starts (turn off with `open_on_start: false`) and draws the other mods' sections into it.
- Files: it reads `~/.config/side-stack/config.json` (or `$XDG_CONFIG_HOME/side-stack/config.json`), creates it once when missing, and rewrites it when you run `/stack order`, `/stack header` or `/stack footer`.
- It registers the `/stack` command and reads the session state that its guest mods share with it (their `stacked` flags and plan-checklist's `showStack` counter).
- It watches prompts, turns and tool calls only to set itself up again after a `/clear`; it does not read their content, block them or change them.
- Network and processes: the plugin's own code makes no network requests and starts no processes.
