// The contract other plugins read. A guest declares the same key in its own
// types/index.d.ts to read `present`. No top-level export here: this file stays
// a global declaration so the `declare module` block merges into the API types.
declare module 'claude-code' {
  interface PluginState {
    // true once side-stack has set itself up in this session. A hint only:
    // presence is `stack` from side-stack in $.command.list(). Session state,
    // so it is gone after a /clear until side-stack's next event sets it.
    'side-stack': {
      present: boolean
      // Where each section goes (plugin names; null = empty, or install order for `order`).
      zones: { order: string[] | null; header: string[] | null; footer: string[] | null }
      setUpFor: string
      // The last guest ask (its `showStack` number) answered by opening the pane.
      shownFor: number
    }
    // Each known guest's own flag, written by that guest: true while it draws
    // its section into the pane `side-stack`. side-stack only reads them.
    'assumptions-pane': { stacked: boolean }
    'idea-shelf': { stacked: boolean }
    // plan-checklist also counts up `showStack` to ask for the pane (see register.tsx).
    'plan-checklist': { stacked: boolean; showStack: number }
    'clean-view': { stacked: boolean }
  }
}
