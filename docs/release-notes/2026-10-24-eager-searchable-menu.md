## PR #272: restore eager searchable menus

Restore master's complete context-menu implementation and type-ahead capture, removing the deferred
menu loading shell and buffered-key replay. Search, navigation, Enter-pick, Escape to finish naming
and typing after a pick follow the existing eager behavior. Restore master's eager node naming
container and existing lazy identity-field boundary as well: the deferred container lost immediate
post-pick typing in targeted tests. Other canvas-readout and Live capacity/overflow trims remain.

Keep behavior regressions for menu ordering, other controls' Enter, naming and delayed identity-field
focus; remove only menu-download/replay-specific scenarios. Add a production-bundle regression that
requires all menu implementation modules and the naming container in the canvas first view. Temporarily restoring the deferred
implementation makes that regression fail on MenuList.tsx.

`pnpm bench:bundle`: all four budgets pass. Gzip bytes (headroom): entry 107,897 (15,603), startup
173,418 (3,582), canvas first view 380,961 (2,039), Live session 124,720 (10,280). Startup and canvas
headroom warn below 8,192 B; limits remain unchanged. Against the PR merge-base, these change by
+34 B, +34 B, -1,405 B and -9,896 B respectively.

No serialized or visual output change is intended; no parity goldens were changed. This fix round
runs targeted menu, naming, lazy-surface and bundle specs plus final static checks; full-suite and
parity validation remain with PR CI under the fix-round verification rule.

The first targeted run passed 29 unit and 105 browser tests but failed immediate quick-add naming
(`Hot keys` became `s`). The isolated case failed again (`ot keys`) with the naming-container trim.
Clean origin/master d79b73c4 passed both naming-spec runs: 74 passed, zero failed/flaky. This evidence
required restoring the naming dependency too, rather than treating the failure as pre-existing.
