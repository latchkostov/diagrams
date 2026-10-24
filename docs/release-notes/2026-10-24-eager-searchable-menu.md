## PR #272: restore eager searchable menus

Restore master's complete context-menu implementation and type-ahead capture, removing the deferred
menu loading shell and buffered-key replay. Search, navigation, Enter-pick, Escape to finish naming
and typing after a pick follow the existing eager behavior. All other bundle trims remain.

Keep behavior regressions for menu ordering, other controls' Enter, naming and delayed node-panel
focus; remove only menu-download/replay-specific scenarios. Add a production-bundle regression that
requires all menu implementation modules in the canvas first view. Temporarily restoring the deferred
implementation makes that regression fail on MenuList.tsx.

`pnpm bench:bundle`: all four budgets pass. Gzip bytes (headroom): entry 107,919 (15,581), startup
173,440 (3,560), canvas first view 375,916 (7,084), Live session 126,280 (8,720). Startup and canvas
headroom warn below 8,192 B; limits remain unchanged. Against the PR merge-base, these change by
+56 B, +56 B, -6,450 B and -8,336 B respectively.

No serialized or visual output change is intended; no parity goldens were changed. This fix round
runs targeted menu, naming, lazy-surface and bundle specs plus final static checks; full-suite and
parity validation remain with PR CI under the fix-round verification rule.
