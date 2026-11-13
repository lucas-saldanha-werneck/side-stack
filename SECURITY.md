# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Open the repository's
[Security tab](https://github.com/lucas-saldanha-werneck/side-stack/security) and choose
"Report a vulnerability" (GitHub private vulnerability reporting).

## Supported versions

Only the latest release is supported. Fixes land there.

## What this plugin accesses

- It runs inside Claude Code's mod host and draws the other mods' sections into one pane.
- Files: it reads and creates `~/.config/side-stack/config.json`, and the `/stack order` command rewrites that file when you change the order.
- Network and processes: the plugin's own code makes no network requests and starts no processes.

