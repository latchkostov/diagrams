## Keep the latest routing request

A delayed inspector field mount can no longer consume a newer request to open the Default row or the New route form. Each field consumes only the request serial it rendered. The newest context-menu action keeps its intended form and focus while earlier mounts finish.

Two layout/passive-effect interleaving regressions fail without the fix and pass with it. All 13 routing browser cases pass on Windows, including repeat Add traffic mix requests and retaining the draft during a rename. No simulation, planning calculation or exported output is intentionally changed.
