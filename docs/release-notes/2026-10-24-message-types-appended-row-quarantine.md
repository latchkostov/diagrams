## Message types: appended-row identity quarantined (PR #300)

Restored master's appended-rule tracking after review found that the snapshot identity registry
loses rows across Edit together projections and room Undo/Redo. MT-09 is OPEN again; its identity
regressions remain quarantined pending an owner decision about stable rule ids in the data model.
The original rekey/focus browser test remains running unchanged.

The bounded exact-first search selector, distinct search accessible names, read-only card Escape,
SVG title ownership, picker-cycle tests, MT-01–05, MT-08 and MT-10 remain in the PR. Search miss
wording, repeated vocabulary normalization and no-match regression coverage are queued as OPEN
in the [backlog](../backlog/2026-10-24-message-types-appended-row.md).

This quarantine changes no parity goldens. PR CI retains full-suite verification; local validation
is limited to the requested message-types and inspector tests, bundle headroom and static checks.
