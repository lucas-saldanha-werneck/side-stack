# side-stack

A Claude Code mod that opens one side pane, titled Stack, where the other side panes stack one under
the other, instead of one tab each.

## Why

The desktop app and the terminal show separate panes as tabs: one is shown, the others wait behind
their tab. With assumptions-pane, idea-shelf, plan-checklist and clean-view installed, you see one
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

At the prompt of a terminal Claude Code session:

```
/plugin marketplace add lucas-saldanha-werneck/claude-plugins
/plugin install side-stack@lucas-plugins
```

side-stack alone shows an empty pane with an install hint. Install the mods that fill it:

```
/plugin install assumptions-pane@lucas-plugins
/plugin install idea-shelf@lucas-plugins
/plugin install plan-checklist@lucas-plugins
/plugin install clean-view@lucas-plugins
```

A guest version without side-stack support keeps its own pane, and the Stack pane keeps showing its
install hint rather than a blank body.

From a shell, the same commands work with `claude plugin` in place of `/plugin`. `/plugin` does not
run in the desktop app: install from a terminal with the user scope, and the mod also loads in the
desktop app's local Code sessions.

Each guest works alone too. Without side-stack, it opens its own pane and its own tab, as before.

## Use

- The pane opens by itself when a session starts, in the terminal and in the desktop app. side-stack
  makes the same call on both; where the pane goes is the engine's choice:
  - **Terminal:** a pane opened unasked (from session start) is placed only when the window is at
    least 144 columns wide, or 110 once you have opened it yourself and not closed it by hand since.
    Below that it waits, undrawn, until the window widens or you run `/stack`. Docked beside the
    transcript in fullscreen mode, otherwise inline above the prompt.
  - **Desktop app:** the column floor is written as terminal columns in the API types (Claude Code
    2.1.319, `PaneOpenArgs` and `UiOpenResult`), and they say a remote surface that reports it
    places panes has `$.ui.open` placed there. So in the app the pane is expected to open at start
    with no width rule, as one tab among any other panes. If the app has not attached yet when the
    session starts, the pane stays open and is drawn once it attaches. This comes from the types;
    it has not been tried by hand in the app.
- `/stack` opens it at any width, on both.
- Sections show in install (load) order unless you set an order: see [Order](#order).
- `/stack order` shows the sections numbered, grouped as Header, Body and Footer.
- `/stack order 3,1,2` orders the body; `/stack header 1` and `/stack footer 2` move sections to the
  top or the bottom, each zone in its own order; `/stack header none` and `/stack footer none` empty
  a zone; `/stack order reset` puts everything back. Numbers, names, or a mix (`plan-checklist,2`).

## Settings

The first session creates `~/.config/side-stack/config.json` (or `$XDG_CONFIG_HOME/side-stack/config.json`)
with every value `null`, which means the default. An existing file is never rewritten, and plugin
updates never touch it.

| Key | Default | What it does |
| --- | --- | --- |
| `title` | `"Stack"` | The pane's title. |
| `open_on_start` | `true` | Open the pane by itself at session start. `/stack` opens it either way. |
| `order` | install order | The order of the body (between header and footer), as a list of plugin names. See [Order](#order). |
| `header` | `null` (none) | Sections shown at the top, in this order. See [Header and footer](#header-and-footer). |
| `footer` | `null` (none) | Sections shown at the bottom, in this order. See [Header and footer](#header-and-footer). |

## Order

By default the sections follow install (load) order: the plugins load in an order the engine picks,
and that order is what you see. `/stack order` lists every section side-stack knows (the four
guests below, plus any other plugin whose section it has seen in the pane), numbered top to bottom
and grouped as Header, Body and Footer; a name not drawing now is marked `(not shown)`:

```
Header: (empty)
Body:
1 · plan-checklist
2 · idea-shelf
3 · assumptions-pane (not shown)
4 · clean-view (not shown)
Footer: (empty)
```

To change the order of the body, list the numbers, the names, or a mix:

```
/stack order 2,1
/stack order idea-shelf,1
```

The numbers are the ones `/stack order` showed last (run it again after a change: they move). The
pane redraws at once, and the order is saved as `order` in the settings file, so the next session
uses it too. Plugins you leave out follow the listed ones, in install order. Other commands:

- `/stack order reset` goes back to install order and empties the header and the footer (`order`,
  `header` and `footer` become `null`).
- An unknown name, or a number with no section, changes nothing; the answer lists what is known.

## Header and footer

```
/stack header 3          # section 3 at the top
/stack footer 1,4        # sections 1 and 4 at the bottom, in that order
/stack header none       # the header's sections go back to the body
/stack footer none
```

Each list replaces that zone and keeps its own order; a section you move leaves the zone it was in.
They are saved as `header` and `footer` in the settings file (`null` = empty). The pane shows the
header on top, then the body, then the footer.

With the pane docked beside the transcript (fullscreen terminal) and everything fitting its height,
the footer stays at the bottom of the pane and the space is left between body and footer. When the
sections do not fit, the pane is inline (above the prompt), or a guest loaded before side-stack draws
in the pane (side-stack cannot measure its section, see below), the zones show as one plain column
that scrolls, so no row is ever cut off. Whether everything fits is an estimate from the sections'
text and layout, made on the high side: in doubt the footer is not pinned.

How it works: in the drawing chain, plugins loaded earlier wrap the ones loaded later. side-stack
takes each guest's section out of what is drawn beneath it and puts them back in your order. For a
guest loaded before side-stack (drawn above it, out of its sight) it leaves an empty slot at the
right place, and that guest moves its section into the slot. This needs guests that follow protocol
version 4 (below). An older guest still shows: on top if it loaded before side-stack, at the end if
it loaded after, wherever your order puts it.

## How a plugin joins the stack

The protocol, version 4:

1. **Is side-stack there?** It is when `$.command.list()` lists `stack` whose `plugin`, with any
   `@marketplace` suffix removed, is `side-stack`. That alone. Check again at every point where you
   would open, close or retitle your own pane (a moment after session start, about a second later,
   each new item, each of your commands, and whenever `$.session.id()` differs from the id you
   loaded under), since load order is unknown.

   side-stack also keeps the session value `{ plugin: 'side-stack', key: 'present' }` set to `true`,
   for older guests. Read it as a hint at most, never as a requirement: `$.state` is per session,
   and a `/clear` ends the session (the process goes on under a new session id, no `session.start`
   fires), so the value is gone afterwards until side-stack sets it again on the first prompt, turn,
   command or tool call of the new session.

   After a `/clear`, reload your list from `$.store` when the session id changed (a render hook may
   not write state: schedule it with `$.clock.after(0, ...)`), then check presence again and set your
   `stacked` flag again: it was session state too.

   Declare the keys you read and write in your own `types/index.d.ts`, with no top-level `export` in
   that file (`present` only if you read it):

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
   clean-view.
3. **Do not open your own pane.** Close it with `$.ui.close` if you already did, or have it draw one
   line, "Shown in the Stack pane (/stack)", so a list never shows twice.
4. **Draw your section** by hooking the Stack pane, and always include what `next(e)` returns, so
   the plugins after you still show. For the order to apply to you (v4), wrap your section in a Box
   keyed `side-stack:<your plugin>`, and when the tree beneath you holds an empty Box keyed
   `side-stack:slot:<your plugin>` (side-stack is beneath you and wants you there), return a copy of
   that tree with the slot replaced by your section:

   ```tsx
   type N = { props?: Record<string, unknown>; children?: unknown[] }
   // A copy of the tree with my slot replaced by my section, or undefined.
   function fill(n: unknown, section: unknown): unknown {
     const el = n as N | null
     if (el === null || typeof el !== 'object' || !Array.isArray(el.children)) return undefined
     for (let i = 0; i < el.children.length; i++) {
       const c = el.children[i] as N | null
       const swap = c?.props?.key === 'side-stack:slot:idea-shelf' ? section : fill(c, section)
       if (swap !== undefined) {
         const children = [...el.children]
         children[i] = swap
         return { ...el, children }
       }
     }
     return undefined
   }

   on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
     const { Box, Text } = $.ui.resolve(e)
     const section = (
       <Box key="side-stack:idea-shelf" flexDirection="column">
         <Text bold>Ideas</Text>
         {/* your rows, capped so you do not push the others off screen */}
       </Box>
     )
     const below = await next(e)
     const filled = fill(below, section)
     if (filled !== undefined) return filled as typeof below
     return <Box flexDirection="column">{section}{below}</Box>
   })
   ```

   Start the section with a one-line heading (`Ideas`, `Assumptions`, `Plan 2/4`) so stacked parts
   are told apart.
5. **Bring the stack forward.** `$.ui.panes()` lists only your own panes, and the types do not say
   that `$.ui.open({ id: 'side-stack' })` from a guest reaches side-stack's pane rather than opening
   one of the guest's own, so do not rely on it. The supported way is to run the host's command: `void $.command.run({ command: 'stack' }).catch(() => {})`. Per the API types (2.1.319),
   `$.command.run` is queued and runs once the session is idle, shows its line in the transcript
   ("Stack pane opened."), and rejects when called inside a hook the turn or session start waits
   on, so do not await it there. Whether a pane opened from a plugin-run command counts as "asked"
   (placed at any width) has not been tried. The types list "a queued prompt" among the things that
   are not asking, so in the terminal expect the 144-column rule; if it does not show, fall back to
   your own pane.
6. **side-stack absent:** behave as you do alone: your own pane, your own tab.

## How it works

One hooks module (`hooks/register.tsx`). At session start it sets the `present` value, creates the
settings file if missing, registers `/stack` and opens the pane. It remembers that session's id; the
first event under another id (after a `/clear`) does the same again, without rewriting the settings
file and without opening a second pane. Its `ui.render` hook on the pane
calls `next(e)`; with no order, header or footer set it returns what that gives inside its own Box,
and with them it rearranges the v4 sections into the three zones and leaves slots as described under
[Order](#order) (with a header or footer, a known guest loaded before side-stack and listed nowhere
gets a slot at the top of the body, where it would show anyway). It keeps the zones from the settings
file in the module (read at session start, after a `/clear` and by `/stack order`, `header` and
`footer`), because a real `/clear` empties session state but keeps module values; those commands
also redraw the pane at once. Zones you type into the file by hand take effect at the next session
start or `/clear`; a name listed in two zones stays in the first of header, footer, order. It adds the install hint only when
nothing visible came back and no known guest's `stacked` flag is `true`. A pane title from the
settings file is cleaned of control characters (line breaks, tabs, escapes) and cut at 60
characters; `/stack` answers with a line instead of failing when the pane cannot open.

## Uninstall

```
/plugin uninstall side-stack@lucas-plugins
```

Guests go back to their own panes from the next session.

## Limits

- Built and tested on Claude Code 2.1.319. It needs a version with mods (hooks modules).
- Tests: `claude plugin validate .` and `claude plugin test .` (CI on Ubuntu, macOS and Windows). The
  tests stack fake guests loaded before and after side-stack. Two plugins sharing one pane was also
  tried by hand with throwaway mods; side-stack itself with the real guests has not
  been tried by hand yet.
- The tests draw the pane, the install hint and stacked guests on both the `terminal` and the
  `desktop` surface (the hint also on `mobile` and `vscode`). The kit checks the trees the mod
  returns, not how a surface paints them or where it places the pane.
- Not tested on the mobile app.
- A real terminal test (Claude Code 2.1.319) showed that session `$.state` does not carry over a
  `/clear`. side-stack sets `present` again, and opens its pane again (with `open_on_start`, when it
  is not open), on the first prompt, turn, command or tool call that runs under the new session id,
  or right after the pane draws under it. A test models that `/clear` (session end, new id, no
  session start, empty state) on the terminal and desktop surfaces; the fix itself has not been
  tried by hand yet.
- The order survives a real `/clear`: tried by hand in a real terminal session (Claude Code 2.1.319)
  with the four guests, before and after `/clear`, and after changing the order between two
  `/clear`s. Not tried in the desktop app.
- Ordering was proven by hand in a real terminal with throwaway mods (guests above and beneath the
  host, three orders). side-stack's own ordering code and the `/stack order` command are covered by
  the tests (terminal and desktop) but have not been tried by hand with the real guests, and not at
  all in the desktop app.
- Header, footer and item numbers (0.4.0) are covered by the tests (terminal and desktop), including
  the pinned and the plain footer layouts as trees. Tried by hand in a real terminal (Claude Code
  2.1.321, 220x60, the four guests): `/stack header 1` then `/stack footer 2` put idea-shelf on top
  and assumptions-pane pinned at the bottom of the docked pane. That run found that the engine
  refuses its own node (what `next(e)` returns at the bottom) under a Box with a height, so side-stack
  keeps it outside the pinned box; a test covers it. Not checked in the desktop app.

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
