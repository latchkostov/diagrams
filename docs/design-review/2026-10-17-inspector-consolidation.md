## Inspector consolidation UX review

The requested concept map changes file ownership only. No controls, DOM wrappers, text, test ids,
classes, ARIA, styles, focus stops, keyboard behavior or camera calls change. The shell is untouched;
the existing NodeIdentity, NodeSimulation, EdgeAdvanced, RelationHint and bulk components retain their
component boundaries after moving into their concept files.

A parser-based comparison against the starting commit verifies that all 65 top-level declarations
are identical after excluding imports, comments and formatting. This includes the name-edit hook,
input draft effects, copy-chip timer, disclosure state, dismissed hints and bulk undo sequence.
Existing tests provide behavioral coverage without changed assertions or new timing assumptions.

Keep the 600-line bulk-selection concept together. Reject further visual-section splits, helper
grab bags, behavior cleanup, new controls and golden updates: each would work against the scope or
the agreed granularity. InspectorProps remains shared, so types.ts stays. No product UX is changed.

The targeted Linux gate exposed a live edge-label naming failure that also occurs on clean master:
a message-trace card is open during the attempted edge context menu. The branch times out waiting
for the menu action; master times out when the trace card intercepts the preceding right-click.
Record both outcomes in `docs/backlog/2026-10-17-inspector-consolidation-live-edge-menu.md`; do not
change behavior or weaken assertions as part of this consolidation.
