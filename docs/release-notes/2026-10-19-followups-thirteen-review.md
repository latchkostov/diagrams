## Follow-ups 13 review fixes

Roster entries awaiting an epoch's parent now have their signatures checked against the sending peer's
allowance before being buffered. Only verified entries wait for authority resolution, so junk cannot
consume the honest peer's allowance when that peer supplies the missing chain. Existing buffer limits remain.

Shift+F10 and the Menu key open a focused SVG connection's menu in Edit and Live; Escape returns focus
to that connection. Entering slow motion with a pending Inputs rebuild preserves the entry viewport,
which Escape restores. No controls or UI text were added.

The TraceCard loading regression now matches both development modules and production chunks. New
regressions cover sender budgets, cached signature results, SVG shortcuts including direct key dispatch,
and camera restoration through synchronous and asynchronous rebuilds. Deliberately reverting the fixes
fails those regressions. No output golden changes are intended or recorded.

## Verification follow-up

The five-repeat Linux load run passed 689 tests and failed one unchanged annotation Markdown preview
click test. The required two-run comparison of that spec on clean master passed all 64 tests, so the
failure is not proven to reproduce there. Details are tracked in
[the follow-up](../backlog/2026-10-19-annotation-preview-click-load.md); its assertion remains unchanged.

The single full Linux gate passed static checks, unit coverage, builds, size and unchanged output parity.
It failed the unchanged benchmark off-pane setup (“no empty spot on the canvas”). Remaining browser work
was interrupted to bound verification: 678 passed, 1 failed, 1,136 skipped/interrupted. That spec passed
both clean-master comparison runs (6 tests), so this failure is also not proven to reproduce there.
[The benchmark follow-up](../backlog/2026-10-19-benchmark-off-pane-load.md) records the exact summaries.
