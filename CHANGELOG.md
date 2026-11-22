# Changelog

Versions are the `version` in `.claude-plugin/plugin.json`. Newest first.

## 0.5.2 (2026-11-22)
- Guest protocol: the host is looked for again 5 s, 15 s and 60 s after start (`HOST_CHECKS_MS`), so a guest that opened its own pane before side-stack loaded (slow machine) closes it later instead of staying as a separate tab.

## 0.5.1 (2026-11-18)

- Answer each guest's showStack ask in its own entry, `shownBy[<guest>]`, so two guests asking at once never read each other's number (plan-checklist still gets `shownFor` too).
- `stack-guest.tsx`: one ask (or one `/stack` fallback) at a time.

## 0.5.0 (2026-11-18)

- New `hooks/stack-guest.tsx`: the guest protocol (presence, slot, drawn-once check, silent ask for the pane, the Remote Control rule) and the section heading in one file, copied byte for byte into each guest.
- Rendering split by surface: one look for the terminal, one for the apps (desktop, mobile, VS Code), set in `STYLE`. Both draw the same tree for now.
- idea-shelf and assumptions-pane can now ask for the pane silently (their `showStack` counters), as plan-checklist does.
- The empty pane has a `Stack · empty` heading; `/stack order` leaves out empty zones; one short usage line.

## 0.4.9 (2026-11-18)

- Guest guide: on Claude Code 2.1.327 and later a guest's hook must name `plugin: '*'` to draw in the Stack pane; how to keep older builds working too.

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

