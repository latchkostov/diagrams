## Viewer build review

No controls, interactions or visual defaults change. Read-only viewers cannot open the editor's
context menus or quick-add, so omitting their action factories preserves their existing behavior.
Saved routes still use the same router and shaped-route renderer. The editor keeps its full action
catalog. Both viewer builds check this boundary in regression tests; temporarily restoring the
catalog makes both tests fail.

## Scope

Keep the existing ZIP cap and test timeout. Reject additional compression iterations: their CPU
cost caused coverage timeouts. Remove unused editor actions instead of reducing viewer features
or altering saved-route geometry.
