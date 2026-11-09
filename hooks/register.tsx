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

// Where each section goes: `header` (top), `footer` (bottom) and `order` (the
// body in between), each a list of plugin names in its own order, or null
// (empty zone; for `order`, install order). Loaded from the settings file into
// session state so the pane, which reads it while drawing, redraws the moment
// /stack order, header or footer changes it.
export type Zones = { order: string[] | null; header: string[] | null; footer: string[] | null }
const NO_ZONES: Zones = { order: null, header: null, footer: null }
const zones = atom({ plugin: 'side-stack', key: 'zones' } as const, NO_ZONES as Zones)

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
    "order": "The order of the body (the sections between header and footer), as a list of plugin names, e.g. [\\"plan-checklist\\", \\"idea-shelf\\"]. Default: install order. /stack order a,b,c sets it (numbers from /stack order work too), /stack order reset clears order, header and footer.",
    "header": "Sections shown at the top, in this order, as a list of plugin names. Default: none. /stack header a,b sets it, /stack header none empties it.",
    "footer": "Sections shown at the bottom, in this order, as a list of plugin names. Docked with room to spare, they stay at the bottom of the pane. Default: none. /stack footer a,b sets it, /stack footer none empties it."
  },
  "title": null,
  "open_on_start": null,
  "order": null,
  "header": null,
  "footer": null
}
`

type Config = { title: string; openOnStart: boolean; zones: Zones }

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

// Each name in one zone only: header first, then footer, then the body order.
export const cleanZones = (v: { order?: unknown; header?: unknown; footer?: unknown }): Zones => {
  const header = cleanOrder(v.header)
  const footer = cleanOrder(cleanOrder(v.footer)?.filter(n => !header?.includes(n)))
  const order = cleanOrder(cleanOrder(v.order)?.filter(n => !header?.includes(n) && !footer?.includes(n)))
  return { order, header, footer }
}

const readConfig = async ($: EngineInterface): Promise<Config> => {
  const cfg: Config = { title: DEFAULT_TITLE, openOnStart: true, zones: NO_ZONES }
  try {
    const file = await settingsFile($)
    if (file === undefined) return cfg
    const raw: unknown = JSON.parse(await $.fs.read(file))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return cfg
    const { title, open_on_start, order, header, footer } = raw as Record<string, unknown>
    cfg.zones = cleanZones({ order, header, footer })
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
// The v4 sections found beneath at the last drawing, in the order met (install
// order), so /stack order can number them as they show. Command answers only.
let lastBeneath: string[] = []

// Each known guest's `stacked` flag. Every flag is read (no early return), so
// a drawing that reads them follows each of them.
const stackedFlags = async ($: EngineInterface): Promise<Record<string, boolean>> => {
  const flags = await Promise.all([
    read($, assumptionsStacked).catch(() => false),
    read($, ideasStacked).catch(() => false),
    read($, planStacked).catch(() => false),
    read($, cleanViewStacked).catch(() => false),
  ])
  return { 'assumptions-pane': flags[0] === true, 'idea-shelf': flags[1] === true, 'plan-checklist': flags[2] === true, 'clean-view': flags[3] === true }
}

// The session id side-stack last set itself up in, kept IN session state.
// A /clear ends the session: the process goes on under a NEW id with no
// session.start, and session $.state is emptied, but events can reach a mod
// under the new id BEFORE that happens (seen on 2.1.319). A marker in a
// module variable set in that window would outlive the emptying and nothing
// would set things up again; one in $.state is emptied with the rest, so the
// next event (or the pane's next draw) sees the mismatch and sets up again.
const setUpFor = atom({ plugin: 'side-stack', key: 'setUpFor' } as const, '')

// The zones from the settings file, kept in the module: a real /clear empties
// session $.state but keeps module values (seen on 2.1.319), so the pane keeps
// the order, header and footer after a /clear. undefined = not read yet (a
// fresh module): the pane reads the file then. Refreshed at each set-up and by
// /stack order, header and footer.
let cachedZones: Zones | undefined

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
  try {
    await update($, present, () => true)
    // Only a set-up whose writes landed counts: one that was refused (say, from
    // a context that may not write) is tried again on the next event.
    await update($, setUpFor, () => id ?? '')
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
  cachedZones = cfg.zones
  try {
    await update($, zones, () => cfg.zones)
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
  if (id === undefined) return
  let done = ''
  try {
    done = await read($, setUpFor)
  } catch {
    // unreadable: set up again, it is harmless
  }
  if (id === done) return
  await setUp($, id, false)
}

const known = (z: Zones): string[] =>
  [...new Set([...GUESTS, ...seen, ...(z.header ?? []), ...(z.order ?? []), ...(z.footer ?? [])])]

// Every known name by zone, numbered top to bottom as the pane shows them:
// the header, then the body (guests drawn above side-stack and not listed, the
// listed order, the rest drawn beneath in install order, then names not
// drawing now), then the footer.
export const numbered = (z: Zones, flags: Record<string, boolean>, beneath: readonly string[]): { header: string[]; body: string[]; footer: string[] } => {
  const header = z.header ?? []
  const footer = z.footer ?? []
  const listed = (z.order ?? []).filter(n => !header.includes(n) && !footer.includes(n))
  const rest = known(z).filter(n => !header.includes(n) && !footer.includes(n) && !listed.includes(n))
  const above = rest.filter(n => flags[n] === true && !beneath.includes(n))
  const drawn = beneath.filter(n => rest.includes(n) && !above.includes(n))
  const others = rest.filter(n => !above.includes(n) && !drawn.includes(n))
  return { header, body: [...above, ...listed, ...drawn, ...others], footer }
}

// Writes the zones into the settings file, keeping every other key. A file
// that is there but is not a JSON object is left alone (the error says so).
const saveZones = async ($: EngineInterface, z: Zones): Promise<string | undefined> => {
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
  cfg.order = z.order
  cfg.header = z.header
  cfg.footer = z.footer
  try {
    await $.fs.write(file, JSON.stringify(cfg, null, 2) + '\n')
  } catch (err) {
    return `could not write ${file}: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`
  }
  return undefined
}

const HELP =
  'Change it with /stack order 3,1,2 (the body), /stack header 1 or /stack footer 2 (numbers or names, or a mix), ' +
  '/stack header none, /stack footer none, or /stack order reset (all back to install order).'

// /stack order|header|footer [list | none | reset]: show the zones, or set one.
const zoneCommand = async ($: EngineInterface, zone: 'order' | 'header' | 'footer', arg: string): Promise<string> => {
  const current = (await readConfig($)).zones
  const flags = await stackedFlags($)
  const view = numbered(current, flags, lastBeneath)
  const all = [...view.header, ...view.body, ...view.footer]
  const names = known(current)
  const show = (v: typeof view): string => {
    let i = 0
    const shown = (n: string) => flags[n] === true || lastBeneath.includes(n)
    const group = (label: string, items: string[], empty: string) =>
      items.length === 0 ? [`${label}: ${empty}`] : [`${label}:`, ...items.map(n => `${++i} · ${n}${shown(n) ? '' : ' (not shown)'}`)]
    return [...group('Header', v.header, '(empty)'), ...group('Body', v.body, '(empty)'), ...group('Footer', v.footer, '(empty)')].join('\n')
  }
  if (arg === '') return `${show(view)}\n${HELP}`
  let next: Zones
  if (zone === 'order' && arg === 'reset') {
    next = NO_ZONES
  } else if (zone !== 'order' && arg === 'none') {
    next = { ...current, [zone]: null }
  } else {
    const asked: string[] = []
    for (const word of arg.split(/[\s,]+/).filter(w => w !== '')) {
      if (/^\d+$/.test(word)) {
        const n = Number(word)
        if (n < 1 || n > all.length) return `Not changed: no item ${word} (1 to ${all.length}).\n${show(view)}`
        asked.push(all[n - 1]!)
      } else if (names.includes(word)) {
        asked.push(word)
      } else {
        return `Not changed: unknown ${word}. Known: ${names.join(', ')}`
      }
    }
    const list = cleanOrder(asked)
    if (list === null) return `Not changed: nothing given. Known: ${names.join(', ')}`
    // The listed items leave whatever zone they were in.
    const drop = (z: string[] | null) => cleanOrder((z ?? []).filter(n => !list.includes(n)))
    next = { order: drop(current.order), header: drop(current.header), footer: drop(current.footer), [zone]: list }
  }
  const failed = await saveZones($, next)
  if (failed !== undefined) return `Not changed: ${failed}`
  cachedZones = next
  try {
    await update($, zones, () => next)
  } catch {
    // saved and cached; the redraw below still shows it
  }
  $.ui.invalidate('ui.render')
  const done =
    next === NO_ZONES ? 'Reset: install order, no header, no footer.'
    : zone === 'order' ? `Order: ${(next.order ?? []).join(', ')}. Sections not listed follow in install order.`
    : next[zone] === null ? `${zone === 'header' ? 'Header' : 'Footer'}: empty; its sections are back in the body.`
    : `${zone === 'header' ? 'Header' : 'Footer'}: ${(next[zone] ?? []).join(', ')}.`
  return `${done}\n${show(numbered(next, flags, lastBeneath))}`
}

// Rows a tree takes in `columns` cells, estimated from its shape and text.
// Used only to tell whether everything fits so the footer can be pinned; it
// errs on the high side (a row of several pieces counts as its text laid out
// end to end, or its tallest piece), because a high guess only means "do not
// pin", while a low one would cut rows off.
export const estimateRows = (node: unknown, columns: number): number => {
  const width = Math.max(1, columns)
  const wrap = (text: string, truncate: boolean): number =>
    text === '' ? 0 : text.split('\n').reduce((sum, line) => sum + (truncate ? 1 : Math.max(1, Math.ceil(line.length / width))), 0)
  const textOf = (n: unknown): string => {
    if (n === null || n === undefined || typeof n === 'boolean') return ''
    if (typeof n === 'string' || typeof n === 'number') return String(n)
    if (Array.isArray(n)) return n.map(textOf).join('')
    if (typeof n !== 'object') return ''
    const el = n as Node
    const label = el.props?.label ?? el.props?.text ?? el.props?.value ?? el.props?.source
    return (typeof label === 'string' ? label : '') + textOf(el.children)
  }
  const num = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0)
  const rows = (n: unknown): number => {
    if (n === null || n === undefined || typeof n === 'boolean') return 0
    if (typeof n === 'string' || typeof n === 'number') return wrap(String(n), false)
    if (Array.isArray(n)) return n.reduce((sum: number, c) => sum + rows(c), 0)
    if (typeof n !== 'object') return 0
    const el = n as Node
    const p = el.props ?? {}
    if (typeof p.height === 'number') return p.height
    const kids = (el.children ?? []).filter(c => hasContent(c) || (c !== null && typeof c === 'object' && typeof (c as Node).props?.height === 'number'))
    if (el.type === 'Text') {
      const truncate = typeof p.wrap === 'string' && p.wrap.startsWith('truncate')
      return wrap(textOf(el.children), truncate)
    }
    if (el.type !== 'Box') return Math.max(1, wrap(textOf(el), false)) + (p.borderStyle !== undefined ? 2 : 0)
    const edges =
      num(p.padding) * 2 + num(p.paddingY) * 2 + num(p.paddingTop) + num(p.paddingBottom) +
      num(p.margin) * 2 + num(p.marginY) * 2 + num(p.marginTop) + num(p.marginBottom) +
      (p.borderStyle !== undefined ? 2 : 0)
    if (p.flexDirection === 'row' || p.flexDirection === 'row-reverse') {
      if (kids.length === 0) return edges
      return edges + Math.max(wrap(textOf(kids), false), ...kids.map(rows))
    }
    const gap = num(p.gap) + num(p.rowGap)
    return edges + kids.reduce((sum: number, c) => sum + rows(c), 0) + gap * Math.max(0, kids.length - 1)
  }
  return rows(node)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A new session: nothing drawn in it yet.
    lastBeneath = []
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
    const first = words[0]
    if (first === 'order' || first === 'header' || first === 'footer') {
      return { text: await zoneCommand($, first, e.args.trim().slice(first.length).trim()) }
    }
    if (words.length > 0) {
      return { text: 'Usage: /stack (open the pane), /stack order (show the sections, numbered), /stack order 3,1,2, /stack header 1, /stack footer 2, /stack header none, /stack footer none, /stack order reset' }
    }
    // Another plugin asking for the pane (to bring a section forward) gets the
    // outcome as a value and nothing is printed: in a headless run
    // (`claude -p`) a printed line would land in the run's output.
    const quiet = e.origin?.kind === 'plugin'
    try {
      await update($, present, () => true)
      const opened = await $.ui.open({ id: PANE_ID, title: cfg.title })
      if (quiet) return {}
      return { text: opened.isPlaced ? `${cfg.title} pane opened.` : `${cfg.title} pane not shown: ${opened.reason}` }
    } catch (err) {
      if (quiet) return {}
      return { text: `${cfg.title} pane not opened: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const { Box, Text } = $.ui.resolve(e)
    // A render may not write state: a new session id is set up from a timer.
    const id = await currentSession($)
    // Read while drawing, so the emptying of state at a /clear redraws the pane.
    const done = await read($, setUpFor).catch(() => '')
    if (id !== undefined && id !== done) $.clock.after(0, () => void resync($))
    // Every guest beneath this hook draws its section here. Never skip it.
    const below: RenderElement = await next(e)
    const { sections, rest } = extractSections(below)
    for (const name of sections.keys()) seen.add(name)
    lastBeneath = [...sections.keys()]
    // Read for the subscription (a change redraws the pane); the module copy
    // is what counts, since session state is empty after a /clear.
    const fromState = await read($, zones)
    if (cachedZones === undefined) {
      const fromFile = (await readConfig($)).zones
      cachedZones = fromFile.order !== null || fromFile.header !== null || fromFile.footer !== null ? fromFile : fromState
    }
    const z = cachedZones
    // A guest loaded before side-stack draws above this hook, out of its sight;
    // its `stacked` flag tells that it draws.
    const flags = await stackedFlags($)
    const filled = hasContent(below) || Object.values(flags).some(f => f)
    if (!filled) {
      return (
        <Box flexDirection="column">
          {below}
          <Text dimColor>Install {GUESTS.slice(0, -1).join(', ')} or {GUESTS.at(-1)} to fill this pane:</Text>
          {GUESTS.map(name => (
            <Text dimColor>/plugin install {name}@lucas-plugins</Text>
          ))}
        </Box>
      )
    }
    // The section found beneath, or an empty slot a guest above fills.
    const take = (name: string): unknown => {
      const found = sections.get(name)
      if (found === undefined) return <Box key={SLOT + name} flexDirection="column" />
      sections.delete(name)
      return found
    }
    if (z.header === null && z.footer === null) {
      if (z.order === null) return <Box flexDirection="column">{below}</Box>
      // The ordered names first, then v4 sections not listed, then everything
      // else (guests without the v4 key), each in install order.
      const parts: unknown[] = z.order.map(take)
      parts.push(...sections.values(), ...rest)
      return <Box flexDirection="column">{parts as RenderElement[]}</Box>
    }
    // Zones. Known guests drawn above side-stack and listed nowhere get a slot
    // at the top of the body, where they would show with no zones at all (they
    // would otherwise draw above the header).
    const listed = new Set([...(z.header ?? []), ...(z.order ?? []), ...(z.footer ?? [])])
    const aboveSlots = GUESTS.filter(n => !listed.has(n) && !sections.has(n)).map(take)
    // Size unknown: a known guest drawing above side-stack (its section lands in
    // a slot, or around this whole tree, after this hook returns).
    const unknownSize = GUESTS.some(n => flags[n] && !sections.has(n))
    const header = (z.header ?? []).map(take)
    const footer = (z.footer ?? []).map(take)
    // The engine's own drawing of the pane (an `engine` node) may not sit under
    // a Box with a height: when pinned it goes after the fixed-height box.
    const isEngine = (n: unknown) => n !== null && typeof n === 'object' && (n as Node).type === 'engine'
    const engineNodes = rest.filter(isEngine)
    const others = rest.filter(n => !isEngine(n))
    const body = [...aboveSlots, ...(z.order ?? []).map(take), ...sections.values(), ...others]
    const headerBox = <Box key="stack-header" flexDirection="column">{header as RenderElement[]}</Box>
    const bodyBox = <Box key="stack-body" flexDirection="column">{body as RenderElement[]}</Box>
    const bodyWithEngine = <Box key="stack-body" flexDirection="column">{[...body, ...engineNodes] as RenderElement[]}</Box>
    const footerBox = <Box key="stack-footer" flexDirection="column" flexShrink={0}>{footer as RenderElement[]}</Box>
    // The footer is pinned to the bottom of a docked pane while everything
    // fits its room; otherwise one plain column that scrolls, nothing cut.
    const room = e.props.scroll?.bodyRows ?? 0
    const isPinned =
      e.props.placement === 'dock' && room > 0 && !unknownSize && hasContent(footer) &&
      estimateRows([header, body, footer], e.props.bodyColumns) <= room
    if (!isPinned) {
      return (
        <Box flexDirection="column">
          {headerBox}
          {bodyWithEngine}
          {footerBox}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box key="stack-pinned" flexDirection="column" height={room}>
          <Box key="stack-top" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
            {headerBox}
            {bodyBox}
          </Box>
          {footerBox}
        </Box>
        {engineNodes as RenderElement[]}
      </Box>
    )
  })
}
