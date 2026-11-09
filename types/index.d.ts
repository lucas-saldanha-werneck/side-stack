// The contract other plugins read. A guest declares the same key in its own
// types/index.d.ts to read `present`. No top-level export here: this file stays
// a global declaration so the `declare module` block merges into the API types.
declare module 'claude-code' {
  interface PluginState {
    // true once side-stack has started in this session: guests then draw into
    // the pane `side-stack` instead of opening their own.
    'side-stack': { present: boolean }
  }
}
