# side-stack

A Claude Code mod that opens one side pane, titled Stack, where other mods draw their sections one
under the other.

## Why

The desktop app and the terminal show separate panes as tabs: one is shown, the others wait behind
their tab. With assumptions-pane, idea-shelf, plan-checklist and quiet-tools installed, you see one
of them at a time. With side-stack installed, they draw into the same pane, so you see them all at
once. This
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

side-stack draws nothing of its own while a guest draws. With no guest drawing, the pane shows one
dim line telling which plugins fill it, and the command that installs each from its own repo.

## Install

At the prompt of a terminal Claude Code session, from this repo (works now):

```
/plugin install side-stack --marketplace lucas-saldanha-werneck/side-stack
```

After side-stack is in the lucas-plugins catalog (not yet):

```
/plugin marketplace add lucas-saldanha-werneck/claude-plugins
/plugin install side-stack@lucas-plugins
```

side-stack alone shows an empty pane with an install hint. Install the mods that fill it, each from
its own repo (works now):

```
/plugin install assumptions-pane --marketplace lucas-saldanha-werneck/assumptions-pane
/plugin install idea-shelf --marketplace lucas-saldanha-werneck/idea-shelf
/plugin install plan-checklist --marketplace lucas-saldanha-werneck/plan-checklist
/plugin install quiet-tools --marketplace lucas-saldanha-werneck/quiet-tools
```

or, after they are in the lucas-plugins catalog with side-stack support:

```
/plugin install assumptions-pane@lucas-plugins
/plugin install idea-shelf@lucas-plugins
/plugin install plan-checklist@lucas-plugins
/plugin install quiet-tools@lucas-plugins
```

The side-stack support in each guest is being added. A guest version without it keeps its own pane,
and the Stack pane keeps showing its install hint rather than a blank body.

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

The protocol, version 2:

1. **Is side-stack there?** side-stack sets the session value `{ plugin: 'side-stack', key: 'present' }`
   to `true` at session start (and again on `/stack`). Any plugin can read it; only side-stack writes
   it. There is no unload event, so the flag alone can outlive the plugin (uninstalled or disabled
   mid-session). Treat side-stack as present only when the flag is `true` AND `$.command.list()` lists
   `stack` whose `plugin`, with any `@marketplace` suffix removed, is `side-stack`. Check again at
   every point where you would open, close or retitle your own pane (a moment after session start,
   about a second later, each new item, each of your commands), since load order is unknown.
   side-stack sets the flag to `false` on `session.end`, except for a `/clear` or a resume: there the
   process goes on and no new `session.start` fires.

   Declare the keys you read and write in your own `types/index.d.ts`, with no top-level `export` in
   that file:

   ```ts
   declare module 'claude-code' {
     interface PluginState {
       'side-stack': { present: boolean }
       'idea-shelf': { stacked: boolean } // your own name; add it to your other keys
     }
   }
   ```

2. **Say that you draw.** While you draw into the stack, set your own `{ plugin: '<your plugin>',
   key: 'stacked' }` to `true`, and back to `false` when you stop. side-stack hides its install hint
   only when a known guest's `stacked` is `true` or something visible is drawn beneath it, never just
   because a guest's command exists. Known guests: assumptions-pane, idea-shelf, plan-checklist,
   quiet-tools.
3. **Do not open your own pane.** Close it with `$.ui.close` if you already did, or have it draw one
   line, "Shown in the Stack pane (/stack)", so a list never shows twice.
4. **Draw your section** by hooking the Stack pane, and always include what `next(e)` returns, so
   the plugins after you still show:

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

   Start the section with a one-line heading (`Ideas`, `Assumptions`, `Plan 2/4`) so stacked parts
   are told apart.
5. **Bring the stack forward.** Panes are per plugin: `$.ui.open` and `$.ui.panes()` only reach your
   own, so a guest cannot open the `side-stack` pane directly. The supported way is to run the host's
   command: `void $.command.run({ command: 'stack' }).catch(() => {})`. Per the API types (2.1.319),
   `$.command.run` is queued and runs once the session is idle, shows its line in the transcript
   ("Stack pane opened."), and rejects when called inside a hook the turn or session start waits
   on, so do not await it there. Whether a pane opened from a plugin-run command counts as "asked"
   (placed at any width) or follows the 144-column rule has not been checked; if it does not show,
   fall back to your own pane.
6. **side-stack absent:** behave as you do alone: your own pane, your own tab.

## How it works

One hooks module (`hooks/register.tsx`). At session start it sets the `present` value, creates the
settings file if missing, registers `/stack` and opens the pane. Its `ui.render` hook on the pane
calls `next(e)` and returns what that gives inside its own Box; it adds the install hint only when
nothing visible came back and no known guest's `stacked` flag is `true`. A pane title from the
settings file is cleaned of control characters (line breaks, tabs, escapes) and cut at 60
characters; `/stack` answers with a line instead of failing when the pane cannot open.

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
- Whether `$.state` values survive a `/clear` was not checked. `/stack` sets `present` again, so
  running it after a `/clear` restores the flag if it was lost.

## Credits

The guests come from mods shown in the AI LABS video
[Claude Mods Are Insane... You Need To Try These Right Now](https://www.youtube.com/watch?v=ERNqRK6sMJY)
(9 Oct 2026): Assumption Checker ([06:39](https://www.youtube.com/watch?v=ERNqRK6sMJY&t=399)),
Idea Shelf ([08:52](https://www.youtube.com/watch?v=ERNqRK6sMJY&t=532)) and Plain Answers
([11:41](https://www.youtube.com/watch?v=ERNqRK6sMJY&t=701)). This code was written separately with
Claude Code.

## License

MIT. See `LICENSE`.

Built with Claude Code
