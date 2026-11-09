// The contract other plugins read. A guest declares the same key in its own
// types/index.d.ts to read `present`. No top-level export here: this file stays
// a global declaration so the `declare module` block merges into the API types.
declare module 'claude-code' {
  interface PluginState {
    // true once side-stack has started in this session. A guest also checks
    // that `stack` from side-stack is in $.command.list(): there is no unload
    // event, so the flag alone can outlive the plugin.
    'side-stack': { present: boolean }
    // Each known guest's own flag, written by that guest: true while it draws
    // its section into the pane `side-stack`. side-stack only reads them.
    'assumptions-pane': { stacked: boolean }
    'idea-shelf': { stacked: boolean }
    'plan-checklist': { stacked: boolean }
    'quiet-tools': { stacked: boolean }
  }
}
