import type { EngineInterface, MatchedHook, RenderElement, ResolveInput } from 'claude-code'

// stack-guest: the side-stack guest protocol and the shared look, in one file.
//
// The source copy lives in side-stack (hooks/stack-guest.tsx). Each guest
// (plan-checklist, idea-shelf, assumptions-pane, clean-view) carries a
// byte-identical copy, since plugins cannot import each other; each guest's CI
// fails when its copy differs from side-stack's. Change it here first, then
// copy it to the guests.
//
// Where the looks live: `lookOf(e.surface)` turns a surface into a Look,
// 'terminal' (the terminal) or 'app' (desktop, mobile and VS Code). Every view
// takes that Look, and STYLE below holds what each look draws with. Today both
// looks draw the same tree; a change for one place goes in its own STYLE entry
// (or a `look === 'app'` branch in a view), so the other place is untouched.

// ---- Looks -------------------------------------------------------------------

export type Look = 'terminal' | 'app'

/** The terminal draws one look; the desktop, mobile and VS Code apps the other. */
export const lookOf = (surface: unknown): Look => (surface === undefined || surface === 'terminal' ? 'terminal' : 'app')

export type Section = 'plan-checklist' | 'idea-shelf' | 'assumptions-pane' | 'clean-view' | 'side-stack'

type Style = {
  /** The character a section heading's divider is drawn with. */
  rule: string
  /** Each section's heading color: theme names, so they follow light and dark themes. */
  color: Record<Section, string>
}

export const STYLE: Record<Look, Style> = {
  terminal: {
    rule: '─',
    color: { 'plan-checklist': 'planMode', 'idea-shelf': 'suggestion', 'assumptions-pane': 'permission', 'clean-view': 'remember', 'side-stack': 'subtle' },
  },
  app: {
    rule: '─',
    color: { 'plan-checklist': 'planMode', 'idea-shelf': 'suggestion', 'assumptions-pane': 'permission', 'clean-view': 'remember', 'side-stack': 'subtle' },
  },
}

// Long enough for any pane; the row cuts it to the room left.
const RULE_LENGTH = 120

/**
 * A section heading, one row: the name in the section's color, an optional dim
 * detail ("· 2 open"), a dim divider that fills the rest, then an optional
 * action (a Button). It is both the title and the line between sections.
 */
export function heading<E extends ResolveInput>(
  $: EngineInterface,
  e: E,
  look: Look,
  section: Section,
  title: string,
  detail?: string,
  action?: unknown,
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const style = STYLE[look]
  return (
    <Box key={`${section}-heading`} flexDirection="row" gap={1}>
      <Box flexShrink={0}>
        <Text bold color={style.color[section]} wrap="truncate-end">
          {title}
          {detail !== undefined && detail !== '' ? <Text dimColor bold={false}> · {detail}</Text> : null}
        </Text>
      </Box>
      {/* Wrapped, then cut to one row: no ellipsis at the end of the divider. */}
      <Box flexGrow={1} flexShrink={1} overflow="hidden" height={1}>
        <Text dimColor wrap="wrap">
          {style.rule.repeat(RULE_LENGTH)}
        </Text>
      </Box>
      {action !== undefined && action !== null ? <Box flexShrink={0}>{action as RenderElement}</Box> : null}
    </Box>
  ) as RenderElement
}

// ---- The host ----------------------------------------------------------------

export const STACK_PANE = 'side-stack'
// v4 keys: a guest wraps its section in a Box keyed SECTION + name; side-stack
// leaves an empty Box keyed SLOT + name where it wants a guest drawn above it.
export const SECTION = 'side-stack:'
export const SLOT = 'side-stack:slot:'
// Plugin load order is unknown, and on a loaded machine plugins can load many seconds apart:
// look for the host soon after start, a second later, and again up to a minute later.
export const HOST_CHECKS_MS = [100, 1100, 5000, 15000, 60000] as const
// The own pane's one line while the section draws in the Stack pane, so a list never shows twice.
export const STACKED_LINE = 'Shown in the Stack pane (/stack)'

/**
 * side-stack counts as there when its /stack command is listed, and only then.
 * Its `present` flag is session state, gone after a /clear, so it is not read.
 */
export async function hostPresent($: EngineInterface): Promise<boolean> {
  try {
    return (await $.command.list()).some(c => c.name === 'stack' && (c.plugin ?? '').split('@')[0] === 'side-stack')
  } catch {
    return false
  }
}

/** The Stack pane is open (placed, or waiting for room) in this session. */
export async function stackOpen($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === STACK_PANE)
  } catch {
    return false
  }
}

type Node = { props?: Record<string, unknown>; children?: unknown }

const keyOf = (node: unknown): unknown => (node !== null && typeof node === 'object' ? (node as Node).props?.key : undefined)

/** True when the tree already holds the section of `name` (the other of a guest's two registrations drew it). */
export function hasSection(node: unknown, name: string): boolean {
  if (Array.isArray(node)) return node.some(n => hasSection(n, name))
  if (node === null || typeof node !== 'object') return false
  if (keyOf(node) === SECTION + name) return true
  return hasSection((node as Node).children, name)
}

/**
 * A copy of the tree with side-stack's empty slot for `name` replaced by
 * `section`, or undefined when there is no such slot (the host is not beneath,
 * or keeps install order). Nothing is changed in place.
 */
export function fillSlot(node: unknown, section: unknown, name: string): unknown {
  if (keyOf(node) === SLOT + name) return section
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const swapped = fillSlot(node[i], section, name)
      if (swapped !== undefined) {
        const copy = [...node]
        copy[i] = swapped
        return copy
      }
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  const el = node as Node
  if (el.children === undefined) return undefined
  const children = fillSlot(el.children, section, name)
  return children === undefined ? undefined : { ...el, children }
}

type StackRender = MatchedHook<'ui.render', { component: 'Pane'; requestId: 'side-stack' }>

/**
 * A guest's hook on the Stack pane. The engine wants the hook, and every
 * function that receives `$`, declared in the guest's own files, so a guest writes
 *   const drawInStack: StackHook = async ($, e, next) => {
 *     const below = await next(e)
 *     if (hasSection(below, '<guest>')) return below
 *     return placeSection($, e, below, '<guest>', await drawStacked($, e, lookOf(e.surface)).catch(() => null))
 *   }
 *   on('ui.render', { component: 'Pane', requestId: 'side-stack', plugin: '*' }, drawInStack)
 *   on('ui.render', { component: 'Pane', requestId: 'side-stack' }, drawInStack)
 * Claude Code 2.1.327+ hears only a plugin's own drawings unless the matcher
 * names `plugin`; older builds know no `plugin` key on a Pane and run the
 * second. Where both run, `hasSection` sees the first drawing and it is drawn once.
 */
export type StackHook = StackRender

/**
 * Puts a guest's section into the tree drawn beneath it: keyed, in side-stack's
 * slot when there is one, else on top. A null section leaves the tree as it is.
 */
export function placeSection<E extends ResolveInput>($: EngineInterface, e: E, below: RenderElement, name: string, section: unknown): RenderElement {
  if (section === null || section === undefined) return below
  const { Box } = $.ui.resolve(e)
  const keyed = (
    <Box key={SECTION + name} flexDirection="column">
      {section as RenderElement}
    </Box>
  )
  const filled = fillSlot(below, keyed, name)
  if (filled !== undefined) return filled as RenderElement
  return (
    <Box flexDirection="column">
      {keyed}
      {below}
    </Box>
  ) as RenderElement
}

// ---- Bringing the Stack pane forward ------------------------------------------

// The person's last prompt came through Remote Control (phone or claude.ai),
// where no side pane shows: a /stack run there only waits in the chat as a
// queued prompt. null until the person sends one.
let lastPromptFromRemote: boolean | null = null
// Surfaces that show a side pane; any other attached surface is a Remote Control client.
const PANE_SURFACES: readonly string[] = ['terminal', 'desktop', 'vscode']

/**
 * Call from prompt.submit with `e.origin?.kind`: bridge = Remote Control;
 * composer = typed in the terminal, sdk = typed in the desktop app. Other
 * origins (a plugin, a task notification) leave it as it was.
 */
export function notePrompt(kind: string | undefined): void {
  if (kind === 'bridge') lastPromptFromRemote = true
  else if (kind === 'composer' || kind === 'sdk') lastPromptFromRemote = false
}

/** The person's last prompt came through Remote Control (phone or claude.ai). */
export const promptFromPhone = (): boolean => lastPromptFromRemote === true

/** Whether the person is likely reading from Remote Control, where the pane cannot show. */
export async function readingRemotely($: EngineInterface): Promise<boolean> {
  if (lastPromptFromRemote !== null) return lastPromptFromRemote
  try {
    return (await $.session.surfaces()).some(s => !PANE_SURFACES.includes(s))
  } catch {
    return false
  }
}

/** Headless runs (claude -p, robots) have no surface to draw on. */
export async function hasSurface($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).length > 0
  } catch {
    return true
  }
}

export type Ask = {
  /** Counts the guest's own `showStack` one up and resolves the new number. */
  ask: () => Promise<number>
  /**
   * Reads side-stack's answer to this guest: `shownBy[<guest>]` (0.5.1 and
   * later), or `shownFor` for plan-checklist (0.4.7 and later write it for it).
   */
  answer: () => Promise<number>
  /** No answer (an older side-stack): the guest's fallback, such as running /stack. */
  fallback: () => Promise<void>
}

/**
 * Asks side-stack to show its pane with nothing in the chat: the guest counts
 * its `showStack` up, side-stack opens the pane and writes the same number to
 * `shownFor`. The answer is read on a later tick; with none, `fallback` runs.
 * Each step is its own dispatch, so it may start from any hook.
 */
// An ask whose answer is not read yet, or a /stack fallback that has not run yet
// (a command from a plugin waits until the session is idle): no second one meanwhile.
let inFlight = false

export function askForStack($: EngineInterface, how: Ask): void {
  if (inFlight) return
  inFlight = true
  const later = (fn: () => void): void => {
    try {
      $.clock.after(0, fn)
    } catch {
      fn()
    }
  }
  later(() => {
    void (async () => {
      let n = 0
      try {
        n = await how.ask()
      } catch {
        n = 0
      }
      const done = (): void => {
        inFlight = false
      }
      later(() => {
        void (async () => {
          let answered = false
          try {
            // A later ask answered covers this one too.
            answered = n > 0 && (await how.answer()) >= n
          } catch {
            answered = false
          }
          if (!answered) await how.fallback().catch(() => undefined)
          done()
        })().catch(done)
      })
    })()
  })
}

/**
 * Shows the Stack pane when it helps: never headless; asked (an explicit
 * command) always; otherwise only when it is not open and the person is not
 * reading from Remote Control. Resolves whether it asked.
 */
export async function showStack($: EngineInterface, how: Ask, asked = false): Promise<boolean> {
  if (!(await hasSurface($))) return false
  if (!asked && ((await stackOpen($)) || (await readingRemotely($)))) return false
  askForStack($, how)
  return true
}
