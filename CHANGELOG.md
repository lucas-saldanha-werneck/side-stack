# Changelog

Versions are the `version` in `.claude-plugin/plugin.json`. Newest first.

## 0.4.8 (2026-11-13)

- README: add an Examples section.

## 0.4.7 (2026-11-12)

- Open the pane silently when a guest asks by its showStack counter.

## 0.4.6 (2026-11-12)

- The install hint shows again on an empty pane; `/stack order|header|footer` save against the current file.
- Unreadable zones in session state no longer stop the pane drawing.

## 0.4.5 (2026-11-11)

- Pin the footer in any plugin load order.

## 0.4.4 (2026-11-11)

- Point to the catalog repo's new name, `lucas-tools`.

## 0.4.3 (2026-11-11)

- Catalog renamed to `lucas-tools`.

## 0.4.2 (2026-11-09)

- Empty pane: show the catalog install command.

## 0.4.1 (2026-11-09)

- One-line description, catalog install steps, README headings.

## 0.4.0 (2026-11-09)

- Header and footer zones, item numbers in /stack order.

## 0.3.3 (2026-11-09)

- /stack run by another plugin prints nothing.

## 0.3.2 (2026-11-09)

- Keep the set-up marker in session state.

## 0.3.1 (2026-11-09)

- Keep the section order after a real /clear.

## 0.3.0 (2026-11-09)

- Section order: install order by default, /stack order to change it.

## 0.2.1 (2026-11-09)

- After /clear: set present again and reopen the pane on the new session.

## 0.2.0 (2026-11-09)

- Side-stack protocol v2: the install hint hides only when a guest's stacked flag is set or it drew something.
- Strip control characters from the configured title; a failed open in /stack answers with a line.

## 0.1.0 (2026-11-09)

- One side pane other mods stack their sections into.

