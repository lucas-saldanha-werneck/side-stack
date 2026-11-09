import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

// side-stack: one side pane that other mods ("guests") draw their sections
// into, one under the other, instead of each opening a pane of its own (the
// app shows separate panes as tabs, one at a time).
//
// The protocol (v2), for guests:
//   - side-stack is present when the atom { plugin: 'side-stack', key: 'present' }
//     is true AND $.command.list() lists `stack` from plugin side-stack (there is
//     no unload event, so the flag alone can outlive the plugin);
//   - then hook ui.render on { component: 'Pane', requestId: 'side-stack' } and
//     return <Box flexDirection="column">{section}{await next(e)}</Box>;
//   - and set your own { plugin: '<guest>', key: 'stacked' } true while you draw
//     there (false otherwise).
// This host draws nothing of its own while a guest draws, and always includes
// what next(e) returns, so every guest's section shows.

export const PANE_ID = 'side-stack'
export const DEFAULT_TITLE = 'Stack'
export const GUESTS = ['assumptions-pane', 'idea-shelf', 'plan-checklist', 'clean-view'] as const

const present = atom({ plugin: 'side-stack', key: 'present' } as const, false)

// Each known guest's own flag: true while it draws its section into the stack.
// Only the guest writes it; side-stack reads it while drawing, which redraws the
// pane when it changes.
// (One const per guest: the module scan lists what a plugin reads only from
// literal references.)
const assumptionsStacked = atom({ plugin: 'assumptions-pane', key: 'stacked' } as const, false)
const ideasStacked = atom({ plugin: 'idea-shelf', key: 'stacked' } as const, false)
const planStacked = atom({ plugin: 'plan-checklist', key: 'stacked' } as const, false)
const cleanViewStacked = atom({ plugin: 'clean-view', key: 'stacked' } as const, false)

// The section order: plugin names, or null for install (load) order. Loaded
// from the settings file into session state so the pane, which reads it while
// drawing, redraws the moment /stack order changes it.
const order = atom({ plugin: 'side-stack', key: 'order' } as const, null as string[] | null)

// v4 keys: a guest wraps its section in a Box keyed SECTION + name; for an
// ordered guest side-stack did not find beneath it, it leaves an empty Box keyed
// SLOT + name, which that guest (drawing above side-stack) fills.
export const SECTION = 'side-stack:'
export const SLOT = 'side-stack:slot:'

// The starter settings file, written on the first session when there is none.
// Every value is null (= the default), so it changes nothing until edited.
export const CONFIG_EXAMPLE = `{
  "_doc": {
    "about": "Your side-stack settings. Plugin updates never touch this file. null means the default. Keys that start with _ are ignored.",
    "title": "The pane's title. Default: \\"Stack\\".",
    "open_on_start": "Open the pane by itself when a session starts (true or false). Default: true. /stack opens it either way.",
    "order": "The order of the sections, as a list of plugin names, e.g. [\\"plan-checklist\\", \\"idea-shelf\\"]. Default: install order. /stack order a,b,c sets it, /stack order reset clears it."
  },
  "title": null,
  "open_on_start": null,
  "order": null
}
`

type Config = { title: string; openOnStart: boolean; order: string[] | null }

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

// A pane title is one line: control characters (line breaks, tabs, escapes)
// become spaces, runs of spaces one, at most 60 characters.
export const cleanTitle = (title: string): string =>
  title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 60).trim()

// A list of plugin names, trimmed, each once; null when it is not a usable list.
export const cleanOrder = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null
  const names = [...new Set(v.filter((n): n is string => typeof n === 'string').map(n => n.trim()).filter(n => /^[A-Za-z0-9._-]{1,64}$/.test(n)))]
  return names.length > 0 ? names : null
}

const readConfig = async ($: EngineInterface): Promise<Config> => {
  const cfg: Config = { title: DEFAULT_TITLE, openOnStart: true, order: null }
  try {
    const file = await settingsFile($)
    if (file === undefined) return cfg
    const raw: unknown = JSON.parse(await $.fs.read(file))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return cfg
    const { title, open_on_start, order: names } = raw as Record<string, unknown>
    cfg.order = cleanOrder(names)
    if (typeof title === 'string') {
      const clean = cleanTitle(title)
      if (clean !== '') cfg.title = clean
    }
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

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

const keyOf = (n: unknown): string | undefined => {
  const k = n !== null && typeof n === 'object' ? (n as Node).props?.key : undefined
  return typeof k === 'string' ? k : undefined
}

// Splits the tree drawn beneath side-stack into the v4 sections (by guest
// name, in the order met) and everything else (a guest without the v4 key, the
// engine's own body), however deep each guest nested the rest.
export const extractSections = (node: unknown): { sections: Map<string, unknown>; rest: unknown[] } => {
  const sections = new Map<string, unknown>()
  const rest: unknown[] = []
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    const k = keyOf(n)
    if (k !== undefined && k.startsWith(SECTION) && !k.startsWith(SLOT)) {
      const name = k.slice(SECTION.length)
      if (!sections.has(name)) sections.set(name, n)
      else rest.push(n)
      return
    }
    const el = n as Node | null
    if (el !== null && typeof el === 'object' && el.type === 'Box' && k === undefined) {
      // a plain wrapper: its children are what counts
      ;(el.children ?? []).forEach(walk)
      return
    }
    if (hasContent(n)) rest.push(n)
  }
  walk(node)
  return { sections, rest }
}

// Names of v4 sections drawn beneath side-stack in this process, for
// `/stack order` to accept and list. A module value: it only feeds the
// command's answer, never a drawing.
const seen = new Set<string>()

// A known guest says it draws into the stack. A guest whose command is listed
// but that does not draw (a version without side-stack support) does not count.
const guestStacked = async ($: EngineInterface): Promise<boolean> => {
  // Every flag is read (no early return), so the drawing follows each of them.
  const flags = await Promise.all([
    read($, assumptionsStacked).catch(() => false),
    read($, ideasStacked).catch(() => false),
    read($, planStacked).catch(() => false),
    read($, cleanViewStacked).catch(() => false),
  ])
  return flags.some(f => f === true)
}

// The session id side-stack last set itself up in. A /clear ends the session
// and the process goes on under a NEW id with no session.start, and session
// $.state does not carry over, so `present` reads false there. The first event
// that sees another id sets things up again (resync). A module variable: a hot
// reload empties it, which costs one extra, harmless resync.
let setUpIn: string | undefined

const currentSession = async ($: EngineInterface): Promise<string | undefined> => {
  try {
    return await $.session.id()
  } catch {
    return undefined
  }
}

// `/stack` from side-stack is listed in this session.
const stackListed = async ($: EngineInterface): Promise<boolean> => {
  try {
    return (await $.command.list()).some(c => c.name === 'stack' && c.plugin?.split('@')[0] === 'side-stack')
  } catch {
    return false
  }
}

// Sets `present`, makes sure /stack is listed and, with open_on_start, opens
// the pane if it is not open. Never throws.
const setUp = async ($: EngineInterface, id: string | undefined, isStart: boolean): Promise<void> => {
  setUpIn = id
  try {
    await update($, present, () => true)
  } catch {
    // keep going: the command and the pane matter more
  }
  try {
    if (isStart || !(await stackListed($))) {
      await $.command.register({ name: 'stack', description: 'Open the Stack side pane' })
    }
  } catch {
    // already there, or refused
  }
  const cfg = await readConfig($)
  try {
    await update($, order, () => cfg.order)
  } catch {
    // install order until the next try
  }
  if (!cfg.openOnStart) return
  try {
    if (!isStart && (await $.ui.panes()).some(p => p.id === PANE_ID)) return
    // Unasked, the engine places it only in a wide enough terminal; below that
    // it waits. Not awaited, so a waiting pane holds nothing up.
    void $.ui.open({ id: PANE_ID, title: cfg.title }).catch(() => undefined)
  } catch {
    // no pane today
  }
}

// After a /clear: set up again on the first event under the new session id.
const resync = async ($: EngineInterface): Promise<void> => {
  const id = await currentSession($)
  if (id === undefined || id === setUpIn) return
  await setUp($, id, false)
}

const known = (current: readonly string[] | null): string[] => [...new Set([...GUESTS, ...seen, ...(current ?? [])])]

// Writes `order` into the settings file, keeping every other key. A file that
// is there but is not a JSON object is left alone (the error says so).
const saveOrder = async ($: EngineInterface, names: string[] | null): Promise<string | undefined> => {
  const file = await settingsFile($)
  if (file === undefined || !isAbsolute(file)) return 'no home folder to keep the settings file in'
  let cfg: Record<string, unknown>
  try {
    if (await $.fs.exists(file)) {
      const raw: unknown = JSON.parse(await $.fs.read(file))
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return `${file} is not a JSON object; fix it first`
      cfg = raw as Record<string, unknown>
    } else {
      cfg = JSON.parse(CONFIG_EXAMPLE) as Record<string, unknown>
    }
  } catch {
    return `${file} could not be read as JSON; fix it first`
  }
  cfg.order = names
  try {
    await $.fs.write(file, JSON.stringify(cfg, null, 2) + '\n')
  } catch (err) {
    return `could not write ${file}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`
  }
  return undefined
}

// /stack order [a,b,c | reset]: show, set or clear the section order.
const orderCommand = async ($: EngineInterface, arg: string): Promise<string> => {
  const current = (await readConfig($)).order
  const names = known(current)
  if (arg === '') {
    return [
      `Order: ${current === null ? 'install order (default)' : current.join(', ')}`,
      `Known: ${names.join(', ')}`,
      'Change it with /stack order a,b,c or go back with /stack order reset.',
    ].join('\n')
  }
  let next: string[] | null
  if (arg === 'reset') {
    next = null
  } else {
    const asked = arg.split(/[\s,]+/).map(n => n.trim()).filter(n => n !== '')
    const unknown = asked.filter(n => !names.includes(n))
    if (unknown.length > 0) return `Not changed: unknown ${unknown.join(', ')}. Known: ${names.join(', ')}`
    next = cleanOrder(asked)
    if (next === null) return `Not changed: no names given. Known: ${names.join(', ')}`
  }
  const failed = await saveOrder($, next)
  if (failed !== undefined) return `Not changed: ${failed}`
  try {
    await update($, order, () => next)
  } catch {
    // saved; the next session picks it up
  }
  return next === null ? 'Order: install order (default).' : `Order: ${next.join(', ')}. Sections not listed follow in install order.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await seedSettings($)
    await setUp($, await currentSession($), true)
    return next(e)
  })

  // The first events of a session that began with a /clear.
  on('prompt.submit', async ($, e, next) => {
    await resync($)
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    await resync($)
    return next(e)
  })
  on('tool.call', async ($, e, next) => {
    await resync($)
    return next(e)
  })

  // There is no unload event. session.end is the session ending, not the
  // plugin: on `clear` (and `resume`) the process goes on with no new
  // session.start, so the flag stays true there. Otherwise the process exits.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      try {
        await update($, present, () => false)
      } catch {
        // ending anyway
      }
    }
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    await resync($)
    if (e.command !== 'stack') return next(e)
    const cfg = await readConfig($)
    const words = e.args.trim().split(/\s+/).filter(w => w !== '')
    if (words[0] === 'order') return { text: await orderCommand($, e.args.trim().slice(5).trim()) }
    if (words.length > 0) return { text: 'Usage: /stack (open the pane), /stack order, /stack order a,b,c, /stack order reset' }
    try {
      await update($, present, () => true)
      const opened = await $.ui.open({ id: PANE_ID, title: cfg.title })
      return { text: opened.isPlaced ? `${cfg.title} pane opened.` : `${cfg.title} pane not shown: ${opened.reason}` }
    } catch (err) {
      return { text: `${cfg.title} pane not opened: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    // A render may not write state: a new session id is set up from a timer.
    const id = await currentSession($)
    if (id !== undefined && id !== setUpIn) $.clock.after(0, () => void resync($))
    // Every guest beneath this hook draws its section here. Never skip it.
    const below: RenderElement = await next(e)
    const { sections, rest } = extractSections(below)
    for (const name of sections.keys()) seen.add(name)
    const wanted = await read($, order)
    // A guest loaded before side-stack draws above this hook, out of its sight;
    // its `stacked` flag tells that it draws.
    const filled = hasContent(below) || (await guestStacked($))
    if (wanted !== null) {
      // The ordered names first: the section found beneath, or an empty slot a
      // guest above fills. Then v4 sections not listed, then everything else
      // (guests without the v4 key), each in install order.
      const parts: unknown[] = wanted.map(name => {
        const found = sections.get(name)
        if (found === undefined) return <Box key={SLOT + name} flexDirection="column" />
        sections.delete(name)
        return found
      })
      parts.push(...sections.values(), ...rest)
      if (filled) return <Box flexDirection="column">{parts as RenderElement[]}</Box>
    } else if (filled) {
      return <Box flexDirection="column">{below}</Box>
    }
    return (
      <Box flexDirection="column">
        {below}
        <Text dimColor>Install {GUESTS.slice(0, -1).join(', ')} or {GUESTS.at(-1)} to fill this pane:</Text>
        {GUESTS.map(name => (
          <Text dimColor>/plugin install {name} --marketplace lucas-saldanha-werneck/{name}</Text>
        ))}
      </Box>
    )
  })
}
