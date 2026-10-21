## Trace viewport fit timeout during Forge verification

The full Linux gate on `9354d843c76a58120acd79f4de84ffce2d4bc122` completed with 1,918 browser
tests passing and one failure: `round7-polish.spec.ts`, "live view with a trace refits when the AI
panel opens: every node stays in the pane". The predicate at line 95 did not become true within
its existing wait. All 13,340 unit tests, builds, budgets and 2,779 parity goldens passed.

Following the verification budget, only that spec was checked once on a clean archive of
origin/master `b642f42a836cdfb613c75cc00074b505b44ef7ce`, with `--repeat-each=2`, 12 workers,
12 CPUs and a production build: **22 passed, zero failed**. The original failure was not reproduced;
this does not establish that it pre-exists on master. The Forge polish changes no editor camera
code. Investigate the fit/trace/panel interaction without weakening its assertions or wait.

Evidence: `tests/.output/g/rrbtGXS/summary.txt`,
`tests/.output/g/rrbtGXS/e1/checkpoint.json` and `tests/.output/forge-polish-master-round7.log`.
The follow-up commit records evidence only; the full suite is not repeated for this documentation.
