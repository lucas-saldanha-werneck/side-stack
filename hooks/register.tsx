import { atom, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

// side-stack: one side pane that other mods ("guests") draw their sections
// into, one under the other, instead of each opening a pane of its own (the
// app shows separate panes as tabs, one at a time).
//
// The protocol, for guests:
//   - read the atom { plugin: 'side-stack', key: 'present' }: true means this
//     plugin is running in the session;
//   - then hook ui.render on { component: 'Pane', requestId: 'side-stack' } and
//     return <Box flexDirection="column">{section}{await next(e)}</Box>.
// This host draws nothing of its own while a guest draws, and always includes
// what next(e) returns, so every guest's section shows.

export const PANE_ID = 'side-stack'
export const DEFAULT_TITLE = 'Stack'
export const GUESTS = ['assumptions-pane', 'idea-shelf', 'plan-checklist'] as const

const present = atom({ plugin: 'side-stack', key: 'present' } as const, false)

// The starter settings file, written on the first session when there is none.
// Every value is null (= the default), so it changes nothing until edited.
export const CONFIG_EXAMPLE = `{
  "_doc": {
    "about": "Your side-stack settings. Plugin updates never touch this file. null means the default. Keys that start with _ are ignored.",
    "title": "The pane's title. Default: \\"Stack\\".",
    "open_on_start": "Open the pane by itself when a session starts (true or false). Default: true. /stack opens it either way."
  },
  "title": null,
  "open_on_start": null
}
`

type Config = { title: string; openOnStart: boolean }

// Windows does not set HOME unless a shell like Git Bash does; it sets USERPROFILE.
const home = async ($: EngineInterface): Promise<string | undefined> => {
  let h = await $.env.get('HOME')
  if (h === undefined || h === '') h = await $.env.get('USERPROFILE')
  return h !== undefined && h !== '' ? h : undefined
}

// POSIX /x, Windows C:\x or C:/x. A relative path would land in the session's folder.
const isAbsolute = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

// $XDG_CONFIG_HOME/side-stack/config.json, else ~/.config/side-stack/config.json.
// A relative XDG_CONFIG_HOME is ignored, as the XDG spec says.
const settingsFile = async ($: EngineInterface): Promise<string | undefined> => {
  const xdg = await $.env.get('XDG_CONFIG_HOME')
  const h = await home($)
  const base = xdg !== undefined && isAbsolute(xdg) ? xdg : h !== undefined ? `${h}/.config` : undefined
  return base === undefined ? undefined : `${base}/side-stack/config.json`
}

// Creates the settings file when there is none. An existing file is never
// rewritten, and any error is ignored: it never gets in the way of a session.
const seedSettings = async ($: EngineInterface): Promise<void> => {
  try {
    const file = await settingsFile($)
    if (file === undefined || !isAbsolute(file) || (await $.fs.exists(file))) return
    await $.fs.write(file, CONFIG_EXAMPLE)
  } catch {
    // ignored on purpose
  }
}

const readConfig = async ($: EngineInterface): Promise<Config> => {
  const cfg: Config = { title: DEFAULT_TITLE, openOnStart: true }
  try {
    const file = await settingsFile($)
    if (file === undefined) return cfg
    const raw: unknown = JSON.parse(await $.fs.read(file))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return cfg
    const { title, open_on_start } = raw as Record<string, unknown>
    if (typeof title === 'string' && title.trim() !== '') cfg.title = title.trim().slice(0, 60)
    if (typeof open_on_start === 'boolean') cfg.openOnStart = open_on_start
  } catch {
    // missing or broken file: the defaults
  }
  return cfg
}

// True when the tree draws something a person can see: a word, or any element
// other than a layout Box or a Text (a Button, an Input, a Markdown...).
export const hasContent = (node: unknown): boolean => {
  if (node === null || node === undefined || typeof node === 'boolean') return false
  if (typeof node === 'string') return node.trim() !== ''
  if (typeof node === 'number') return true
  if (Array.isArray(node)) return node.some(hasContent)
  if (typeof node !== 'object') return false
  const el = node as { type?: unknown; children?: unknown }
  if (el.type !== 'Box' && el.type !== 'Text') return true
  return hasContent(el.children)
}

// A known guest's slash command is listed: that guest runs in this session.
// `plugin` may carry a marketplace suffix (name@marketplace).
const guestLoaded = async ($: EngineInterface): Promise<boolean> => {
  try {
    const cmds = await $.command.list()
    return cmds.some(c => {
      const owner = c.plugin?.split('@')[0]
      return owner !== undefined && (GUESTS as readonly string[]).includes(owner)
    })
  } catch {
    return false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, present, () => true)
    await seedSettings($)
    await $.command.register({ name: 'stack', description: 'Open the Stack side pane' })
    const cfg = await readConfig($)
    // Unasked, the engine places it only in a wide enough terminal; below that
    // it waits. Not awaited, so a waiting pane does not hold up the session.
    if (cfg.openOnStart) void $.ui.open({ id: PANE_ID, title: cfg.title }).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'stack' }, async $ => {
    const cfg = await readConfig($)
    const opened = await $.ui.open({ id: PANE_ID, title: cfg.title })
    return { text: opened.isPlaced ? `${cfg.title} pane opened.` : `${cfg.title} pane not shown: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    // Every guest beneath this hook draws its section here. Never skip it.
    const below: RenderElement = await next(e)
    // A guest loaded before side-stack draws above this hook, out of its sight;
    // the commands it registered tell that it is there.
    if (hasContent(below) || (await guestLoaded($))) return <Box flexDirection="column">{below}</Box>
    return (
      <Box flexDirection="column">
        {below}
        <Text dimColor>Install {GUESTS.slice(0, -1).join(', ')} or {GUESTS.at(-1)} to fill this pane:</Text>
        {GUESTS.map(name => (
          <Text dimColor>/plugin install {name}@lucas-plugins</Text>
        ))}
      </Box>
    )
  })
}
