# side-stack

A Claude Code mod that opens one side pane, titled Stack, where other mods draw their sections one
under the other.

## Why

The desktop app and the terminal show separate panes as tabs: one is shown, the others wait behind
their tab. With assumptions-pane, idea-shelf and plan-checklist installed, you see one of them at a
time. With side-stack installed, they draw into the same pane, so you see all three at once. This
sketch shows roughly how it looks. It is not a screenshot:

```
Stack
Plan 2/4
  done  Build the pricing section
  ...   Write the tests
Ideas
  Add a dark mode
Assumptions
  ? A1 The table sorts by date, newest first
```

side-stack draws nothing of its own while a guest draws. With no guest installed, the pane shows one
dim line telling which plugins fill it, and how to install them.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install side-stack --marketplace lucas-saldanha-werneck/side-stack
```

side-stack alone shows an empty pane. Install the mods that fill it from the lucas-plugins catalog:

```
/plugin marketplace add lucas-saldanha-werneck/claude-plugins
/plugin install assumptions-pane@lucas-plugins
/plugin install idea-shelf@lucas-plugins
/plugin install plan-checklist@lucas-plugins
```

plan-checklist, and the side-stack support in assumptions-pane and idea-shelf, are being added; until
a guest has it, that guest keeps its own pane.

From a shell, the same commands work with `claude plugin` in place of `/plugin`. `/plugin` does not
run in the desktop app: install from a terminal with the user scope, and the mod also loads in the
desktop app's local Code sessions.

Each guest works alone too. Without side-stack, it opens its own pane and its own tab, as before.

## Use

- The pane opens by itself when a session starts. In a terminal it only opens by itself when the
  window is at least 144 columns wide (the engine's rule for panes nobody asked for). Below that it
  waits.
- `/stack` opens it at any width.
- Sections show in plugin load order, the engine's. A mod cannot change that order.

## Settings

The first session creates `~/.config/side-stack/config.json` (or `$XDG_CONFIG_HOME/side-stack/config.json`)
with every value `null`, which means the default. An existing file is never rewritten, and plugin
updates never touch it.

| Key | Default | What it does |
| --- | --- | --- |
| `title` | `"Stack"` | The pane's title. |
| `open_on_start` | `true` | Open the pane by itself at session start. `/stack` opens it either way. |

## How a plugin joins the stack

The protocol, version 1:

1. side-stack sets the session value `{ plugin: 'side-stack', key: 'present' }` to `true` at session
   start. Any plugin can read it (only side-stack writes it). Declare it in your own
   `types/index.d.ts`, with no top-level `export` in that file:

   ```ts
   declare module 'claude-code' {
     interface PluginState {
       'side-stack': { present: boolean }
     }
   }
   ```

2. When it is `true`, do not open your own pane (close it with `$.ui.close` if you already did).
   Load order is unknown, so read it again a moment after session start.
3. Draw your section by hooking the Stack pane, and always include what `next(e)` returns, so the
   plugins after you still show:

   ```tsx
   on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
     const { Box, Text } = $.ui.resolve(e)
     return (
       <Box flexDirection="column">
         <Text bold>Ideas</Text>
         {/* your rows, capped so you do not push the others off screen */}
         {await next(e)}
       </Box>
     )
   })
   ```

4. Start the section with a one-line heading (`Ideas`, `Assumptions`, `Plan 2/4`) so stacked parts
   are told apart.
5. When it is `false`, behave as you do alone: your own pane, your own tab.

side-stack hides its install hint when something is drawn beneath it, or when a known guest
(assumptions-pane, idea-shelf, plan-checklist) has registered a slash command in the session. That
second check covers a guest that loads before side-stack and so draws above it.

## How it works

One hooks module (`hooks/register.tsx`). At session start it sets the `present` value, creates the
settings file if missing, registers `/stack` and opens the pane. Its `ui.render` hook on the pane
calls `next(e)` and returns what that gives inside its own Box.

## Uninstall

```
/plugin uninstall side-stack@side-stack
/plugin marketplace remove side-stack
```

Guests go back to their own panes from the next session.

## Limits and what was not tested

- Built and tested on Claude Code 2.1.319. It needs a version with mods (hooks modules).
- Tests: `claude plugin validate .` and `claude plugin test .` (CI on Ubuntu, macOS and Windows). The
  tests stack fake guests loaded before and after side-stack. Two plugins sharing one pane was also
  tried by hand with throwaway mods; side-stack itself with the real guests has not
  been tried by hand yet.
- Not tested on the mobile app.

## License

MIT. See `LICENSE`.

Built with Claude Code
