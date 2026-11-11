import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CONFIG_EXAMPLE } from '../hooks/register'

// On Windows the engine resolves a drive-less absolute path onto the current
// drive with backslashes (D:\home\u\...). Compare paths in POSIX form.
const posix = (p: string): string => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

const PANE = {
  plugin: 'side-stack',
  component: 'Pane',
  requestId: 'side-stack',
  props: {
    title: 'Stack',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

type Write = { path: string; text: string }
type Opened = { id: string; title?: string }

const OWNERS: Record<string, string> = { stack: 'side-stack', assumptions: 'assumptions-pane', present: 'idea-shelf' }

// What the engine does beneath every plugin, as plain stand-ins. `have` lists
// the files that exist (POSIX paths) with their text; writes are recorded,
// not made. Every `$.ui.open` is recorded too.
// `drawsPane` false leaves ui.render to the test's own stand-in.
// `openFails` makes every `$.ui.open` reject.
const engine = (on: On, have: Record<string, string> = {}, drawsPane = true, openFails = false): { writes: Write[]; opened: Opened[] } => {
  const writes: Write[] = []
  const opened: Opened[] = []
  mock.env(on, { HOME: '/home/u' })
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never)
  // The engine knows which plugin registered a command; the event does not say,
  // so this stand-in names the owner from the command's name, as a marketplace
  // install shows it (name@marketplace).
  const commands: { name: string; description: string }[] = []
  on('command.register', async (_$, e) => {
    commands.push(e as { name: string; description: string })
    return { value: undefined } as never
  })
  on('command.list', async () => ({
    value: commands.map(c => ({ ...c, source: 'plugin', plugin: `${OWNERS[c.name] ?? 'unknown'}@lucas-tools` })),
  }) as never)
  on('fs.exists', async (_$, e) => ({ value: posix((e as { path: string }).path) in have }) as never)
  on('fs.read', async (_$, e) => {
    const path = posix((e as { path: string }).path)
    if (!(path in have)) throw new Error('ENOENT: ' + path)
    return { value: have[path] } as never
  })
  on('fs.write', async (_$, e) => {
    const w = e as Write
    writes.push({ path: posix(w.path), text: w.text })
    have[posix(w.path)] = w.text
    return { value: undefined } as never
  })
  on('ui.open', async (_$, e) => {
    if (openFails) throw new Error('refused')
    opened.push(e as Opened)
    return { value: { isPlaced: true } } as never
  })
  // The engine's own drawing of a plugin's pane: an empty body.
  if (drawsPane) {
    on('ui.render', async ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box flexDirection="column" />
    })
  }
  return { writes, opened }
}

const start = async ($: unknown, surface: 'terminal' | 'desktop' = 'terminal'): Promise<unknown> =>
  ($ as { session: { start: (e: never) => Promise<unknown> } }).session.start({
    cwd: '/work',
    surface,
    isInteractive: true,
  } as never)

const CONFIG = '/home/u/.config/side-stack/config.json'

// A guest reads the flag the way the protocol says: by its atom, from its own
// plugin. /present answers what it read.
const READER = {
  name: 'idea-shelf',
  register(on: On) {
    on('session.start', async ($, e, next) => {
      await $.command.register({ name: 'present', description: 'test: is side-stack there?' })
      return next(e)
    })
    on('command.run', { command: 'present' }, async $ => {
      const { value } = await $.state.get({ plugin: 'side-stack', key: 'present' })
      return { text: 'present=' + String(value ?? false) }
    })
  },
}

test('session start sets the present flag for guests to read', { plugins: [READER] }, async ($, on) => {
  engine(on)
  const before = await $.command.run({ command: 'present', args: '' } as never)
  expect(JSON.stringify(before)).toContain('present=false')
  expect(await start($)).toEqual({ cwd: '/work' })
  const after = await $.command.run({ command: 'present', args: '' } as never)
  expect(JSON.stringify(after)).toContain('present=true')
})

test('session start opens the Stack pane by itself, in the terminal and the desktop app', async ($, on) => {
  const { opened } = engine(on)
  await start($, 'terminal')
  await start($, 'desktop')
  // The same call on both; where it is placed is the engine's (see README).
  expect(opened).toEqual([
    expect.objectContaining({ id: 'side-stack', title: 'Stack' }),
    expect.objectContaining({ id: 'side-stack', title: 'Stack' }),
  ])
})

test('/stack opens the pane', async ($, on) => {
  const { opened } = engine(on)
  const ran = await $.command.run({ command: 'stack', args: '' } as never)
  expect(opened).toEqual([expect.objectContaining({ id: 'side-stack', title: 'Stack' })])
  expect(JSON.stringify(ran)).toContain('Stack pane opened')
})

test('/stack run by another plugin opens the pane and prints nothing (headless output stays clean)', {
  plugins: [{
    name: 'idea-shelf',
    tier: 'prepend',
    register(on) {
      on('session.start', async ($, e, next) => {
        await $.command.register({ name: 'bring', description: 'test: bring the stack forward' })
        return next(e)
      })
      // A command run from inside a command.run hook is refused, so the
      // guest's run starts from a timer, as the real guests do.
      on('command.run', { command: 'bring' }, async $ => {
        $.clock.after(0, async () => {
          const ran = await $.command.run({ command: 'stack' })
          $.ui.log('ran ' + JSON.stringify(ran ?? null))
        })
        return { text: 'asked' }
      })
    },
  }],
}, async ($, on) => {
  const { opened } = engine(on)
  const logs: string[] = []
  on('ui.log', (_$, e) => {
    logs.push(String((e as { text?: string }).text ?? ''))
    return { value: undefined } as never
  })
  const clock = mock.clock(on, { now: 1_000_000 })
  await start($)
  const before = opened.length
  await $.command.run({ command: 'bring', args: '' } as never)
  await clock.advance(10)
  let ran: string | undefined
  for (let i = 0; i < 50 && ran === undefined; i++) {
    ran = logs.find(l => l.startsWith('ran '))
    if (ran === undefined) await clock.advance(10)
  }
  expect(opened.length).toBeGreaterThan(before)
  expect(ran).toBeDefined()
  expect(String(ran)).not.toContain('Stack pane')
})

test('config: title renames the pane and open_on_start false keeps it closed at start', async ($, on) => {
  const { opened, writes } = engine(on, { [CONFIG]: JSON.stringify({ title: 'Side', open_on_start: false }) })
  await start($)
  expect(opened).toEqual([])
  expect(writes).toEqual([])
  await $.command.run({ command: 'stack', args: '' } as never)
  expect(opened).toEqual([expect.objectContaining({ id: 'side-stack', title: 'Side' })])
})

test('config: the first session writes the starter file, every key null', async ($, on) => {
  const { writes, opened } = engine(on)
  await start($)
  expect(writes).toEqual([{ path: CONFIG, text: CONFIG_EXAMPLE }])
  const cfg = JSON.parse(CONFIG_EXAMPLE) as Record<string, unknown>
  expect(Object.keys(cfg).sort()).toEqual(['_doc', 'footer', 'header', 'open_on_start', 'order', 'title'])
  expect(cfg.title).toBeNull()
  expect(cfg.open_on_start).toBeNull()
  expect(cfg.order).toBeNull()
  expect(cfg.header).toBeNull()
  expect(cfg.footer).toBeNull()
  expect(Object.keys(cfg._doc as object)).toEqual(expect.arrayContaining(['order', 'header', 'footer']))
  // null means the default: the pane still opens at start, titled Stack.
  expect(opened).toEqual([expect.objectContaining({ title: 'Stack' })])
})

test('config: an existing file is never overwritten', async ($, on) => {
  const { writes } = engine(on, { [CONFIG]: '{"title": "Mine"}' })
  await start($)
  await start($)
  expect(writes).toEqual([])
})

test('config: a broken file falls back to the defaults and is left alone', async ($, on) => {
  const { writes, opened } = engine(on, { [CONFIG]: '{ not json' })
  await start($)
  expect(writes).toEqual([])
  expect(opened).toEqual([expect.objectContaining({ title: 'Stack' })])
})

test('with no guest the pane shows which plugins fill it', async ($, on) => {
  engine(on)
  await start($) // side-stack's own /stack is listed and does not count as a guest
  for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const hint = await ui.find({ type: 'Text', text: /to fill this pane/ })
    expect(hint?.text).toBe('Install assumptions-pane, idea-shelf, plan-checklist or clean-view to fill this pane:')
    expect(hint?.props.dimColor).toBe(true)
    for (const name of ['assumptions-pane', 'idea-shelf', 'plan-checklist', 'clean-view']) {
      expect(await ui.find({ type: 'Text', text: `/plugin install ${name}@lucas-tools` })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('the host keeps what is drawn beneath it (next(e)) inside its own tree', async ($, on) => {
  engine(on, {}, false)
  // Stands for whatever answers beneath side-stack in the chain.
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>BELOW</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'BELOW' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a guest loaded after side-stack draws its section in the same pane', {
  plugins: [{
    name: 'idea-shelf',
    tier: 'append',
    register(on) {
      on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
        const { Box, Text } = $.ui.resolve(e)
        return <Box flexDirection="column"><Text>Ideas</Text><Text>one idea</Text>{await next(e)}</Box>
      })
    },
  }],
}, async ($, on) => {
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Ideas' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'one idea' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('two guests, one on each side of side-stack, stack in one pane in load order', {
  plugins: [
    {
      name: 'assumptions-pane',
      tier: 'prepend',
      register(on) {
        on('session.start', async ($, e, next) => {
          await $.command.register({ name: 'assumptions', description: 'Assumptions' })
          return next(e)
        })
        on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
          const { Box, Text } = $.ui.resolve(e)
          return <Box flexDirection="column"><Text>Assumptions</Text>{await next(e)}</Box>
        })
      },
    },
    {
      name: 'plan-checklist',
      tier: 'append',
      register(on) {
        on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
          const { Box, Text } = $.ui.resolve(e)
          return <Box flexDirection="column"><Text>Plan 2/4</Text>{await next(e)}</Box>
        })
      },
    },
  ],
}, async ($, on) => {
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('Assumptions')
    expect(texts).toContain('Plan 2/4')
    expect(texts.indexOf('Assumptions')).toBeLessThan(texts.indexOf('Plan 2/4'))
    expect(texts.some(t => /to fill this pane/.test(t))).toBe(false)
    await ui.unmount()
  }
})

test('a guest loaded before side-stack that says it is stacked hides the install hint', {
  plugins: [{
    name: 'assumptions-pane',
    tier: 'prepend',
    register(on) {
      on('session.start', async ($, e, next) => {
        await $.command.register({ name: 'assumptions', description: 'Assumptions' })
        await $.state.set({ plugin: 'assumptions-pane', key: 'stacked' }, true)
        return next(e)
      })
      on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
        const { Box, Text } = $.ui.resolve(e)
        return <Box flexDirection="column"><Text>Assumptions</Text>{await next(e)}</Box>
      })
    },
  }],
}, async ($, on) => {
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: 'Assumptions' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a guest whose command is listed but that does not draw leaves the hint (no blank pane)', {
  plugins: [{
    name: 'assumptions-pane',
    tier: 'prepend',
    register(on) {
      // An older guest: it registers its command and keeps its own pane.
      on('session.start', async ($, e, next) => {
        await $.command.register({ name: 'assumptions', description: 'Assumptions' })
        return next(e)
      })
    },
  }],
}, async ($, on) => {
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a guest that stops drawing (stacked back to false) brings the hint back', {
  plugins: [{
    name: 'clean-view',
    tier: 'prepend',
    register(on) {
      on('session.start', async ($, e, next) => {
        await $.command.register({ name: 'unstack', description: 'test: stop drawing' })
        await $.state.set({ plugin: 'clean-view', key: 'stacked' }, true)
        return next(e)
      })
      on('command.run', { command: 'unstack' }, async $ => {
        await $.state.set({ plugin: 'clean-view', key: 'stacked' }, false)
        return { text: 'ok' }
      })
    },
  }],
}, async ($, on) => {
  engine(on)
  await start($)
  const uis = [await $.ui.mount({ ...PANE, surface: 'terminal' }), await $.ui.mount({ ...PANE, surface: 'desktop' })]
  for (const ui of uis) expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeUndefined()
  await $.command.run({ command: 'unstack', args: '' } as never)
  for (const ui of uis) {
    expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeDefined()
    await ui.unmount()
  }
})

test('session.end clears the present flag, except on /clear and resume', { plugins: [READER] }, async ($, on) => {
  engine(on)
  on('session.end', async (_$, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
  const end = (reason: string) =>
    ($ as unknown as { session: { end: (e: never) => Promise<unknown> } }).session.end({
      reason, sessionId: 's1', resume: {},
    } as never)
  const ask = async () => JSON.stringify(await $.command.run({ command: 'present', args: '' } as never))
  await start($)
  await end('clear')
  expect(await ask()).toContain('present=true')
  await end('resume')
  expect(await ask()).toContain('present=true')
  await end('prompt_input_exit')
  expect(await ask()).toContain('present=false')
  // /stack sets it again.
  await $.command.run({ command: 'stack', args: '' } as never)
  expect(await ask()).toContain('present=true')
})

test('a title with control characters is cleaned and /stack still opens', async ($, on) => {
  const { opened } = engine(on, { [CONFIG]: JSON.stringify({ title: 'My\nStack\u001b[31m\t ' }) })
  const ran = await $.command.run({ command: 'stack', args: '' } as never)
  expect(opened).toEqual([expect.objectContaining({ id: 'side-stack', title: 'My Stack [31m' })])
  expect(JSON.stringify(ran)).toContain('pane opened')
})

test('a title made only of control characters falls back to Stack', async ($, on) => {
  const { opened } = engine(on, { [CONFIG]: JSON.stringify({ title: '\n\t\u0007' }) })
  await $.command.run({ command: 'stack', args: '' } as never)
  expect(opened).toEqual([expect.objectContaining({ title: 'Stack' })])
})

test('/stack answers instead of failing when the pane cannot open', async ($, on) => {
  engine(on, {}, true, true)
  const ran = await $.command.run({ command: 'stack', args: '' } as never)
  expect(JSON.stringify(ran)).toContain('Stack pane not opened')
})

test('another pane is left to the engine', async ($, on) => {
  engine(on, {}, false)
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...PANE, requestId: 'other', surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

// ---- a real /clear: session.end { reason: 'clear' }, a NEW session id, NO
// session.start, and session $.state that does not carry over.

// A guest written to the v2 rules an older guest follows: it draws into the
// stack only while side-stack's `present` is true AND /stack is listed, keeps
// its list in $.store, and checks again on each prompt whether the session id
// changed since it last looked.
const OLD_GUEST = {
  name: 'idea-shelf',
  tier: 'append' as const,
  register(on: On) {
    // (The module scan wants $ spelled at each call site, so the check is
    // written out in both hooks.)
    let seenIn: string | undefined
    on('session.start', async ($, e, next) => {
      await $.command.register({ name: 'ideas', description: 'Ideas' })
      const ran = await next(e)
      seenIn = await $.session.id()
      const { value: present } = await $.state.get({ plugin: 'side-stack', key: 'present' })
      const listed = (await $.command.list()).some(c => c.name === 'stack' && c.plugin?.split('@')[0] === 'side-stack')
      await $.state.set({ plugin: 'idea-shelf', key: 'stacked' }, present === true && listed)
      return ran
    })
    on('prompt.submit', async ($, e, next) => {
      const id = await $.session.id()
      if (id !== seenIn) {
        seenIn = id
        const { value: present } = await $.state.get({ plugin: 'side-stack', key: 'present' })
        const listed = (await $.command.list()).some(c => c.name === 'stack' && c.plugin?.split('@')[0] === 'side-stack')
        await $.state.set({ plugin: 'idea-shelf', key: 'stacked' }, present === true && listed)
      }
      return next(e)
    })
    on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const { value: stacked } = await $.state.get({ plugin: 'idea-shelf', key: 'stacked' })
      if (stacked !== true) return next(e)
      const items = ((await $.store.get('ideas')) ?? []) as string[]
      return <Box flexDirection="column"><Text>Ideas</Text>{items.map(i => <Text>{i}</Text>)}{await next(e)}</Box>
    })
  },
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`after a real /clear the guest's list is back in the stack (${surface})`, { plugins: [OLD_GUEST] }, async ($, on) => {
    const { opened } = engine(on, {}, true)
    mock.store(on, { ideas: ['one idea'] })
    // Session $.state, one map per session id: a new id starts empty.
    let sid = 's1'
    const state: Record<string, Record<string, { value: unknown; version: number }>> = {}
    on('session.id', async () => ({ value: sid }) as never)
    on('state.get', async (_$, e) => {
      const a = e as { plugin: string; key: string }
      return { value: state[sid]?.[`${a.plugin}.${a.key}`] ?? { value: undefined, version: 0 } } as never
    })
    on('state.set', async (_$, e) => {
      const a = e as { plugin: string; key: string; value: unknown }
      const box = (state[sid] ??= {})
      const version = (box[`${a.plugin}.${a.key}`]?.version ?? 0) + 1
      box[`${a.plugin}.${a.key}`] = { value: a.value, version }
      return { value: { isSet: true, version } } as never
    })
    on('session.end', async (_$, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
    on('prompt.submit', async (_$, e) => ({ text: (e as { text: string }).text }) as never)
    // The pane the /clear left behind is gone from the engine's record here,
    // so side-stack opens it again.
    on('ui.panes', async () => ({ value: [] }) as never)

    const draw = async () => {
      const ui = await $.ui.mount({ ...PANE, surface })
      const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
      await ui.unmount()
      return texts
    }

    await start($, surface)
    expect(await draw()).toEqual(expect.arrayContaining(['Ideas', 'one idea']))
    expect(opened).toHaveLength(1)

    // /clear: the session ends, the process goes on under a new id, no session.start.
    const s = $ as unknown as { session: { end: (e: never) => Promise<unknown> }; prompt: { submit: (e: never) => Promise<unknown> } }
    await s.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
    sid = 's2'
    // Without a new event the new session has nothing: the guest is not stacked.
    expect(await draw()).not.toContain('Ideas')

    // The first prompt after the /clear.
    await s.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)
    const texts = await draw()
    expect(texts).toEqual(expect.arrayContaining(['Ideas', 'one idea']))
    expect(texts.some(t => /to fill this pane/.test(t))).toBe(false)
    expect(state.s2?.['side-stack.present']?.value).toBe(true)
    expect(opened).toHaveLength(2)
  })
}

// A v4 guest: its section in a Box keyed side-stack:plan-checklist; above side-stack it
// fills the empty slot side-stack left for it, else it draws on top as before.
const PLAN_BELOW = {
  name: 'plan-checklist',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const section = <Box key="side-stack:plan-checklist" flexDirection="column"><Text>Plan 2/4</Text></Box>
      const below = await next(e)
      type N = { props?: Record<string, unknown>; children?: unknown[] }
      const fill = (n: unknown): unknown => {
        const el = n as N | null
        if (el === null || typeof el !== 'object' || !Array.isArray(el.children)) return undefined
        for (let i = 0; i < el.children.length; i++) {
          const c = el.children[i] as N | null
          const swap = c !== null && typeof c === 'object' && c.props?.key === 'side-stack:slot:plan-checklist' ? section : fill(c)
          if (swap !== undefined) {
            const children = [...el.children]
            children[i] = swap
            return { ...el, children }
          }
        }
        return undefined
      }
      const filled = fill(below)
      if (filled !== undefined) return filled as typeof below
      return <Box flexDirection="column">{section}{below}</Box>
    })
  },
}
// A v4 guest: its section in a Box keyed side-stack:idea-shelf; above side-stack it
// fills the empty slot side-stack left for it, else it draws on top as before.
const IDEAS_BELOW = {
  name: 'idea-shelf',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const section = <Box key="side-stack:idea-shelf" flexDirection="column"><Text>Ideas</Text></Box>
      const below = await next(e)
      type N = { props?: Record<string, unknown>; children?: unknown[] }
      const fill = (n: unknown): unknown => {
        const el = n as N | null
        if (el === null || typeof el !== 'object' || !Array.isArray(el.children)) return undefined
        for (let i = 0; i < el.children.length; i++) {
          const c = el.children[i] as N | null
          const swap = c !== null && typeof c === 'object' && c.props?.key === 'side-stack:slot:idea-shelf' ? section : fill(c)
          if (swap !== undefined) {
            const children = [...el.children]
            children[i] = swap
            return { ...el, children }
          }
        }
        return undefined
      }
      const filled = fill(below)
      if (filled !== undefined) return filled as typeof below
      return <Box flexDirection="column">{section}{below}</Box>
    })
  },
}
// A v4 guest: its section in a Box keyed side-stack:assumptions-pane; above side-stack it
// fills the empty slot side-stack left for it, else it draws on top as before.
const ASSUME_ABOVE = {
  name: 'assumptions-pane',
  tier: 'prepend' as const,
  register(on: On) {
    on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const section = <Box key="side-stack:assumptions-pane" flexDirection="column"><Text>Assumptions</Text></Box>
      const below = await next(e)
      type N = { props?: Record<string, unknown>; children?: unknown[] }
      const fill = (n: unknown): unknown => {
        const el = n as N | null
        if (el === null || typeof el !== 'object' || !Array.isArray(el.children)) return undefined
        for (let i = 0; i < el.children.length; i++) {
          const c = el.children[i] as N | null
          const swap = c !== null && typeof c === 'object' && c.props?.key === 'side-stack:slot:assumptions-pane' ? section : fill(c)
          if (swap !== undefined) {
            const children = [...el.children]
            children[i] = swap
            return { ...el, children }
          }
        }
        return undefined
      }
      const filled = fill(below)
      if (filled !== undefined) return filled as typeof below
      return <Box flexDirection="column">{section}{below}</Box>
    })
  },
}
// A guest without the v4 key (an older version): section, then the rest.
const OLD_ABOVE = {
  name: 'clean-view',
  tier: 'prepend' as const,
  register(on: On) {
    on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      return <Box flexDirection="column"><Text>Clean View (old)</Text>{await next(e)}</Box>
    })
  },
}
// A guest without the v4 key (an older version): section, then the rest.
const OLD_BELOW = {
  name: 'clean-view',
  tier: 'append' as const,
  register(on: On) {
    on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      return <Box flexDirection="column"><Text>Clean View (old)</Text>{await next(e)}</Box>
    })
  },
}

// ---- v4: section order

const textsOf = async ($: { ui: { mount: Function } }, surface: 'terminal' | 'desktop'): Promise<string[]> => {
  const ui = await $.ui.mount({ ...PANE, surface })
  const texts = ((await ui.findAll({ type: 'Text' })) as { text: string }[]).map(t => t.text)
  await ui.unmount()
  return texts
}
const sectionsOf = (texts: string[]): string[] =>
  texts.filter(t => ['Plan 2/4', 'Ideas', 'Assumptions', 'Clean View (old)'].includes(t))
const run = async ($: unknown, args: string): Promise<string> =>
  JSON.stringify(await ($ as { command: { run: Function } }).command.run({ command: 'stack', args }))
const savedOrder = (writes: Write[]): unknown => {
  const last = writes.filter(w => w.path === CONFIG).at(-1)
  return last === undefined ? 'no write' : (JSON.parse(last.text) as { order: unknown }).order
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`order: guests beneath follow install order, then /stack order, then reset (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    const { writes } = engine(on, { [CONFIG]: CONFIG_EXAMPLE })
    await start($, surface)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Ideas'])
    expect(await run($, 'order idea-shelf,plan-checklist')).toContain('Order: idea-shelf, plan-checklist')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4'])
    expect(savedOrder(writes)).toEqual(['idea-shelf', 'plan-checklist'])
    // every other key of the file is kept
    const kept = JSON.parse(writes.at(-1)!.text) as Record<string, unknown>
    expect(Object.keys(kept).sort()).toEqual(['_doc', 'footer', 'header', 'open_on_start', 'order', 'title'])
    expect(await run($, 'order reset')).toContain('install order')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Ideas'])
    expect(savedOrder(writes)).toBeNull()
  })

  test(`order: a guest above side-stack fills its slot (${surface})`, { plugins: [ASSUME_ABOVE, PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on)
    await start($, surface)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Assumptions', 'Plan 2/4', 'Ideas'])
    await run($, 'order plan-checklist,assumptions-pane,idea-shelf')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Assumptions', 'Ideas'])
    await run($, 'order idea-shelf,plan-checklist,assumptions-pane')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4', 'Assumptions'])
    // listing only one: the rest follow in install order
    await run($, 'order idea-shelf')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Assumptions', 'Ideas', 'Plan 2/4'])
  })

  test(`order: the saved order comes back in a new session (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on, { [CONFIG]: JSON.stringify({ order: ['idea-shelf', 'plan-checklist'] }) })
    await start($, surface)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4'])
    const shown = await run($, 'order')
    expect(shown).toContain('1 · idea-shelf')
    expect(shown).toContain('2 · plan-checklist')
  })

  test(`order: an unknown name is refused with the known ones, nothing saved (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    const { writes } = engine(on)
    await start($, surface)
    const before = writes.length
    const answer = await run($, 'order idea-shelf,nope')
    expect(answer).toContain('Not changed: unknown nope')
    expect(answer).toContain('Known: assumptions-pane, idea-shelf, plan-checklist, clean-view')
    expect(writes.length).toBe(before)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Ideas'])
  })

  test(`order: guests without the v4 key still show, above on top and beneath at the end (${surface})`, { plugins: [OLD_ABOVE, PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on)
    await start($, surface)
    await run($, 'order idea-shelf,plan-checklist')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Clean View (old)', 'Ideas', 'Plan 2/4'])
  })

  test(`order: a guest beneath without the v4 key goes to the end (${surface})`, { plugins: [OLD_BELOW, PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on)
    await start($, surface)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Clean View (old)', 'Plan 2/4', 'Ideas'])
    await run($, 'order idea-shelf,plan-checklist')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4', 'Clean View (old)'])
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`order: an open pane redraws at once (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on)
    await start($, surface)
    const ui = await $.ui.mount({ ...PANE, surface })
    const now = async () => sectionsOf((await ui.findAll({ type: 'Text' })).map(t => t.text))
    expect(await now()).toEqual(['Plan 2/4', 'Ideas'])
    await run($, 'order idea-shelf,plan-checklist')
    expect(await now()).toEqual(['Ideas', 'Plan 2/4'])
    await ui.unmount()
  })
}

test('/stack order with no list shows every known name, numbered, by zone', async ($, on) => {
  engine(on)
  await start($)
  const answer = await run($, 'order')
  expect(answer).toContain('Header: (empty)')
  expect(answer).toContain('Footer: (empty)')
  for (const [i, name] of ['assumptions-pane', 'idea-shelf', 'plan-checklist', 'clean-view'].entries()) {
    expect(answer).toContain(`${i + 1} · ${name} (not shown)`)
  }
})

test('/stack with other words answers how to use it', async ($, on) => {
  const { opened } = engine(on)
  expect(await run($, 'sideways')).toContain('Usage: /stack')
  expect(opened).toEqual([])
})

// A real /clear (2.1.319): session $.state is empty, module values stay, a new
// session id, no session.start. The pane must keep the saved order at once,
// before any prompt.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`order: kept right after a real /clear, before any event (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on, { [CONFIG]: JSON.stringify({ order: ['idea-shelf', 'plan-checklist'] }) })
    let sid = 's1'
    const state: Record<string, Record<string, { value: unknown; version: number }>> = {}
    on('session.id', async () => ({ value: sid }) as never)
    on('state.get', async (_$, e) => {
      const a = e as { plugin: string; key: string }
      return { value: state[sid]?.[`${a.plugin}.${a.key}`] ?? { value: undefined, version: 0 } } as never
    })
    on('state.set', async (_$, e) => {
      const a = e as { plugin: string; key: string; value: unknown }
      const box = (state[sid] ??= {})
      const version = (box[`${a.plugin}.${a.key}`]?.version ?? 0) + 1
      box[`${a.plugin}.${a.key}`] = { value: a.value, version }
      return { value: { isSet: true, version } } as never
    })
    on('session.end', async (_$, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
    await start($, surface)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4'])
    await ($ as unknown as { session: { end: (e: never) => Promise<unknown> } }).session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
    sid = 's2'
    expect(state.s2).toBeUndefined()
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4'])
  })
}

// The race seen on 2.1.319: after a /clear, events can reach the mod under the
// NEW session id BEFORE session state is emptied. A set-up in that window must
// not count once the state empties: the next event sets up again.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`present is set again after state empties late in a /clear (${surface})`, async ($, on) => {
    engine(on)
    let sid = 's1'
    let state: Record<string, { value: unknown; version: number }> = {}
    on('session.id', async () => ({ value: sid }) as never)
    on('state.get', async (_$, e) => {
      const a = e as { plugin: string; key: string }
      return { value: state[`${a.plugin}.${a.key}`] ?? { value: undefined, version: 0 } } as never
    })
    on('state.set', async (_$, e) => {
      const a = e as { plugin: string; key: string; value: unknown }
      const version = (state[`${a.plugin}.${a.key}`]?.version ?? 0) + 1
      state[`${a.plugin}.${a.key}`] = { value: a.value, version }
      return { value: { isSet: true, version } } as never
    })
    on('session.end', async (_$, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
    on('prompt.submit', async (_$, e) => ({ text: (e as { text: string }).text }) as never)
    const s = $ as unknown as { session: { end: (e: never) => Promise<unknown> }; prompt: { submit: (e: never) => Promise<unknown> } }
    const prompt = () => s.prompt.submit({ text: 'go on', origin: { kind: 'composer' } } as never)

    await start($, surface)
    expect(state['side-stack.present']?.value).toBe(true)
    await s.session.end({ reason: 'clear', sessionId: 's1', resume: {} } as never)
    sid = 's2'
    await prompt() // reaches side-stack under the new id, state not emptied yet
    state = {} // now the engine empties session state
    await prompt()
    expect(state['side-stack.present']?.value).toBe(true)
  })
}

// ---- 0.4.0: item numbers, header and footer zones

const saved = (writes: Write[], key: 'order' | 'header' | 'footer'): unknown => {
  const last = writes.filter(w => w.path === CONFIG).at(-1)
  return last === undefined ? 'no write' : (JSON.parse(last.text) as Record<string, unknown>)[key]
}
const mountWith = async ($: unknown, surface: 'terminal' | 'desktop', props: Record<string, unknown> = {}) =>
  ($ as { ui: { mount: Function } }).ui.mount({ ...PANE, props: { ...PANE.props, ...props }, surface })
const rootOf = async (ui: { drawn: () => Promise<unknown> }): Promise<{ props?: Record<string, unknown> }> =>
  (await ui.drawn()) as { props?: Record<string, unknown> }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`numbers: /stack order 2,1 orders the body by the shown numbers (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    const { writes } = engine(on, { [CONFIG]: CONFIG_EXAMPLE })
    await start($, surface)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Ideas'])
    const shown = await run($, 'order')
    expect(shown).toContain('1 · plan-checklist')
    expect(shown).toContain('2 · idea-shelf')
    expect(shown).toContain('3 · assumptions-pane (not shown)')
    await run($, 'order 2,1')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4'])
    expect(saved(writes, 'order')).toEqual(['idea-shelf', 'plan-checklist'])
  })

  test(`numbers: names and numbers mix in one list (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    const { writes } = engine(on)
    await start($, surface)
    await textsOf($ as never, surface)
    expect(await run($, 'order idea-shelf,1')).toContain('Order: idea-shelf, plan-checklist')
    expect(saved(writes, 'order')).toEqual(['idea-shelf', 'plan-checklist'])
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4'])
  })
}

test('numbers: a number with no item changes nothing and shows the list', { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
  const { writes } = engine(on)
  await start($)
  await textsOf($ as never, 'terminal')
  const before = writes.length
  const answer = await run($, 'header 9')
  expect(answer).toContain('Not changed: no item 9')
  expect(answer).toContain('1 · plan-checklist')
  expect(writes.length).toBe(before)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`zones: footer and header move items there, renumbered after each change (${surface})`, { plugins: [ASSUME_ABOVE, PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    const { writes } = engine(on)
    await start($, surface)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Assumptions', 'Plan 2/4', 'Ideas'])
    // assumptions-pane draws above side-stack; its stacked flag is not set in
    // this stand-in, so it is numbered as listed by name: use the name.
    const footer = await run($, 'footer assumptions-pane')
    expect(footer).toContain('Footer: assumptions-pane')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Ideas', 'Assumptions'])
    expect(saved(writes, 'footer')).toEqual(['assumptions-pane'])
    // Now: body 1 plan-checklist, 2 idea-shelf, ...; footer last.
    const shown = await run($, 'order')
    expect(shown).toContain('1 · plan-checklist')
    expect(shown).toContain('2 · idea-shelf')
    expect(shown).toMatch(/Footer:\\n\d+ · assumptions-pane/)
    await run($, 'header 2')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4', 'Assumptions'])
    expect(saved(writes, 'header')).toEqual(['idea-shelf'])
    expect(saved(writes, 'footer')).toEqual(['assumptions-pane'])
  })

  test(`zones: a zone keeps its own order (${surface})`, { plugins: [ASSUME_ABOVE, PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    const { writes } = engine(on)
    await start($, surface)
    await run($, 'header idea-shelf,plan-checklist')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4', 'Assumptions'])
    await run($, 'header plan-checklist,idea-shelf')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Ideas', 'Assumptions'])
    await run($, 'footer idea-shelf,plan-checklist')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Assumptions', 'Ideas', 'Plan 2/4'])
    // moved out of the header into the footer: the header is empty again
    expect(saved(writes, 'header')).toBeNull()
    expect(saved(writes, 'footer')).toEqual(['idea-shelf', 'plan-checklist'])
  })

  test(`zones: none empties a zone and its items go back to the body (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    const { writes } = engine(on)
    await start($, surface)
    await run($, 'footer plan-checklist')
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Ideas', 'Plan 2/4'])
    expect(await run($, 'footer none')).toContain('Footer: empty')
    expect(saved(writes, 'footer')).toBeNull()
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Ideas'])
    await run($, 'header idea-shelf')
    await run($, 'header none')
    expect(saved(writes, 'header')).toBeNull()
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Ideas'])
  })

  test(`zones: /stack order reset clears order, header and footer (${surface})`, { plugins: [ASSUME_ABOVE, PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    const { writes } = engine(on)
    await start($, surface)
    await run($, 'header idea-shelf')
    await run($, 'footer assumptions-pane')
    await run($, 'order plan-checklist')
    expect(await run($, 'order reset')).toContain('install order')
    expect(saved(writes, 'order')).toBeNull()
    expect(saved(writes, 'header')).toBeNull()
    expect(saved(writes, 'footer')).toBeNull()
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Assumptions', 'Plan 2/4', 'Ideas'])
  })

  test(`zones: an older config with only order still works; header and footer by hand apply at start (${surface})`, { plugins: [ASSUME_ABOVE, PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on, { [CONFIG]: JSON.stringify({ title: null, order: ['idea-shelf', 'plan-checklist'] }) })
    await start($, surface)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Assumptions', 'Ideas', 'Plan 2/4'])
    const shown = await run($, 'order')
    expect(shown).toContain('Header: (empty)')
    expect(shown).toContain('Footer: (empty)')
  })

  test(`zones: header and footer from the settings file, a name in two zones kept in the first (${surface})`, { plugins: [ASSUME_ABOVE, PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on, { [CONFIG]: JSON.stringify({ header: ['plan-checklist'], footer: ['plan-checklist', 'idea-shelf'], order: ['idea-shelf'] }) })
    await start($, surface)
    expect(sectionsOf(await textsOf($ as never, surface))).toEqual(['Plan 2/4', 'Assumptions', 'Ideas'])
  })

  test(`zones: unknown names change nothing (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    const { writes } = engine(on)
    await start($, surface)
    const before = writes.length
    expect(await run($, 'footer nope')).toContain('Not changed: unknown nope')
    expect(writes.length).toBe(before)
  })
}

// ASSUME_ABOVE that also says it is stacked, as the real guests do.
const STACKED_ASSUME_ABOVE = {
  name: 'assumptions-pane',
  tier: 'prepend' as const,
  register(on: On) {
    on('session.start', async ($, e, next) => {
      await $.state.set({ plugin: 'assumptions-pane', key: 'stacked' }, true)
      return next(e)
    })
    on('ui.render', { component: 'Pane', requestId: 'side-stack' }, async ($, e, next) => {
      const { Box, Text } = $.ui.resolve(e)
      const section = <Box key="side-stack:assumptions-pane" flexDirection="column"><Text>Assumptions</Text></Box>
      const below = await next(e)
      type N = { props?: Record<string, unknown>; children?: unknown[] }
      const fill = (n: unknown): unknown => {
        const el = n as N | null
        if (el === null || typeof el !== 'object' || !Array.isArray(el.children)) return undefined
        for (let i = 0; i < el.children.length; i++) {
          const c = el.children[i] as N | null
          const swap = c !== null && typeof c === 'object' && c.props?.key === 'side-stack:slot:assumptions-pane' ? section : fill(c)
          if (swap !== undefined) {
            const children = [...el.children]
            children[i] = swap
            return { ...el, children }
          }
        }
        return undefined
      }
      const filled = fill(below)
      if (filled !== undefined) return filled as typeof below
      return <Box flexDirection="column">{section}{below}</Box>
    })
  },
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`footer: pinned to the bottom when docked with room to spare (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on)
    await start($, surface)
    await run($, 'footer plan-checklist')
    const ui = await mountWith($, surface)
    const pinned = await ui.find({ key: 'stack-pinned' })
    expect(pinned?.props.minHeight).toBe(20)
    expect(pinned?.props.height).toBeUndefined()
    const top = await ui.find({ key: 'stack-top' })
    expect(top?.props.flexGrow).toBe(1)
    // nothing is ever cut: no overflow hidden, no shrinking
    expect(top?.props.overflow).toBeUndefined()
    const footer = await ui.find({ key: 'stack-footer' })
    expect(footer?.props.flexShrink).toBe(0)
    expect(footer?.text).toContain('Plan 2/4')
    expect(sectionsOf((await ui.findAll({ type: 'Text' })).map(t => t.text))).toEqual(['Ideas', 'Plan 2/4'])
    await ui.unmount()
  })

  test(`footer: taller than the pane, the pinned column grows (minHeight), nothing cut (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on)
    await start($, surface)
    await run($, 'footer plan-checklist')
    const ui = await mountWith($, surface, { scroll: { offset: 0, bodyRows: 1 } })
    const pinned = await ui.find({ key: 'stack-pinned' })
    expect(pinned?.props.minHeight).toBe(1)
    expect(pinned?.props.height).toBeUndefined()
    expect(sectionsOf((await ui.findAll({ type: 'Text' })).map(t => t.text))).toEqual(['Ideas', 'Plan 2/4'])
    await ui.unmount()
  })

  test(`footer: not pinned inline or without room (one column) (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on)
    await start($, surface)
    await run($, 'footer plan-checklist')
    for (const props of [{ placement: 'inline' }, { scroll: { offset: 0, bodyRows: 0 } }]) {
      const ui = await mountWith($, surface, props)
      expect(await ui.find({ key: 'stack-pinned' })).toBeUndefined()
      expect(await ui.find({ key: 'stack-top' })).toBeUndefined()
      expect(sectionsOf((await ui.findAll({ type: 'Text' })).map(t => t.text))).toEqual(['Ideas', 'Plan 2/4'])
      await ui.unmount()
    }
  })

  test(`footer: still pinned when a footer guest was loaded before side-stack (fills its slot later) (${surface})`, {
    plugins: [STACKED_ASSUME_ABOVE, PLAN_BELOW, IDEAS_BELOW],
  }, async ($, on) => {
    engine(on)
    await start($, surface)
    await run($, 'footer assumptions-pane')
    const ui = await mountWith($, surface)
    expect((await ui.find({ key: 'stack-pinned' }))?.props.minHeight).toBe(20)
    // it fills its slot, inside the pinned footer
    expect((await ui.find({ key: 'stack-footer' }))?.text).toContain('Assumptions')
    expect(sectionsOf((await ui.findAll({ type: 'Text' })).map(t => t.text))).toEqual(['Plan 2/4', 'Ideas', 'Assumptions'])
    await ui.unmount()
  })

  test(`footer: still pinned when a body guest was loaded before side-stack (${surface})`, {
    plugins: [STACKED_ASSUME_ABOVE, PLAN_BELOW, IDEAS_BELOW],
  }, async ($, on) => {
    engine(on)
    await start($, surface)
    await run($, 'order idea-shelf,assumptions-pane')
    await run($, 'footer plan-checklist')
    const ui = await mountWith($, surface)
    expect((await ui.find({ key: 'stack-pinned' }))?.props.minHeight).toBe(20)
    expect((await ui.find({ key: 'stack-top' }))?.text).toContain('Assumptions')
    expect((await ui.find({ key: 'stack-footer' }))?.text).toContain('Plan 2/4')
    expect(sectionsOf((await ui.findAll({ type: 'Text' })).map(t => t.text))).toEqual(['Ideas', 'Assumptions', 'Plan 2/4'])
    await ui.unmount()
  })

  test(`header only: header on top, no pinning (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on)
    await start($, surface)
    await run($, 'header idea-shelf')
    const ui = await mountWith($, surface)
    expect(await ui.find({ key: 'stack-pinned' })).toBeUndefined()
    expect((await ui.find({ key: 'stack-header' }))?.text).toContain('Ideas')
    await ui.unmount()
  })
}

test('/stack header with no list shows the numbered zones', async ($, on) => {
  engine(on)
  await start($)
  const answer = await run($, 'header')
  expect(answer).toContain('Header: (empty)')
  expect(answer).toContain('1 · assumptions-pane')
})

// The engine's own pane body comes back from next(e) as an `engine` node, and a
// Pane refuses one under a Box with a height (seen on 2.1.321 in a real
// terminal). With no stand-in beneath, the kit hands side-stack that node.
for (const surface of ['terminal', 'desktop'] as const) {
  test(`footer: pinned with the engine's own node beneath, kept outside the pinned column (${surface})`, { plugins: [PLAN_BELOW, IDEAS_BELOW] }, async ($, on) => {
    engine(on, {}, false)
    await start($, surface)
    await run($, 'footer plan-checklist')
    const ui = await mountWith($, surface)
    const root = await rootOf(ui)
    expect(root.props?.height).toBeUndefined()
    const pinned = await ui.find({ key: 'stack-pinned' })
    expect(pinned?.props.minHeight).toBe(20)
    expect((await ui.find({ key: 'stack-footer' }))?.text).toContain('Plan 2/4')
    expect(sectionsOf((await ui.findAll({ type: 'Text' })).map(t => t.text))).toEqual(['Ideas', 'Plan 2/4'])
    await ui.unmount()
  })
}
