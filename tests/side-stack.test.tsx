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
    value: commands.map(c => ({ ...c, source: 'plugin', plugin: `${OWNERS[c.name] ?? 'unknown'}@lucas-plugins` })),
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

const start = async ($: unknown): Promise<unknown> =>
  ($ as { session: { start: (e: never) => Promise<unknown> } }).session.start({
    cwd: '/work',
    surface: 'terminal',
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

test('session start opens the Stack pane by itself', async ($, on) => {
  const { opened } = engine(on)
  await start($)
  expect(opened).toEqual([expect.objectContaining({ id: 'side-stack', title: 'Stack' })])
})

test('/stack opens the pane', async ($, on) => {
  const { opened } = engine(on)
  const ran = await $.command.run({ command: 'stack', args: '' } as never)
  expect(opened).toEqual([expect.objectContaining({ id: 'side-stack', title: 'Stack' })])
  expect(JSON.stringify(ran)).toContain('Stack pane opened')
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
  expect(Object.keys(cfg).sort()).toEqual(['_doc', 'open_on_start', 'title'])
  expect(cfg.title).toBeNull()
  expect(cfg.open_on_start).toBeNull()
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
    expect(hint?.text).toBe('Install assumptions-pane, idea-shelf, plan-checklist or quiet-tools to fill this pane:')
    expect(hint?.props.dimColor).toBe(true)
    for (const name of ['assumptions-pane', 'idea-shelf', 'plan-checklist', 'quiet-tools']) {
      expect(await ui.find({ type: 'Text', text: `/plugin install ${name} --marketplace lucas-saldanha-werneck/${name}` })).toBeDefined()
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
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'BELOW' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeUndefined()
  await ui.unmount()
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
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain('Assumptions')
  expect(texts).toContain('Plan 2/4')
  expect(texts.indexOf('Assumptions')).toBeLessThan(texts.indexOf('Plan 2/4'))
  expect(texts.some(t => /to fill this pane/.test(t))).toBe(false)
  await ui.unmount()
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
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Assumptions' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeUndefined()
  await ui.unmount()
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
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeDefined()
  await ui.unmount()
})

test('a guest that stops drawing (stacked back to false) brings the hint back', {
  plugins: [{
    name: 'quiet-tools',
    tier: 'prepend',
    register(on) {
      on('session.start', async ($, e, next) => {
        await $.command.register({ name: 'unstack', description: 'test: stop drawing' })
        await $.state.set({ plugin: 'quiet-tools', key: 'stacked' }, true)
        return next(e)
      })
      on('command.run', { command: 'unstack' }, async $ => {
        await $.state.set({ plugin: 'quiet-tools', key: 'stacked' }, false)
        return { text: 'ok' }
      })
    },
  }],
}, async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeUndefined()
  await $.command.run({ command: 'unstack', args: '' } as never)
  expect(await ui.find({ type: 'Text', text: /to fill this pane/ })).toBeDefined()
  await ui.unmount()
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
