## Pane adjustments survive menus

An Inspector or pane change now stays pending until its camera follow-up runs. Opening,
cancelling or choosing an item in a context menu defers that follow-up until the menu
closes, including when a second menu interrupts a scheduled retry. It runs once and uses
the current camera owner, preserving a later manual zoom instead of refitting it.

Fake-clock regressions cover right-click opening the Inspector, Escape and Properties
dismissal, a menu opened during an already pending pane change, and a later manual camera
command. Each regression was checked with the fix temporarily reverted.
That run failed all four new tests while the 18 existing Inspector tests passed;
restoring the fix passed all 22 tests.

Output parity is unchanged; no goldens were updated. Regeneration refreshed the
committed skill viewer, which now matches a fresh build.

Validation: the two-worker quick gate passed all 35 Inspector, platform and viewport
browser tests with zero failures or flakes. The full unit suite passed 8,886 tests
(four skipped), with no type errors. Build, entry size, i18n and skill freshness
checks passed. Parity passed all 77 Linux browser cases and checked 2,196 goldens:
zero changed, added, missing or stale. The full gate is left to PR CI for this round.
