## Native unit backstops during the Inspector master merge

The native `pnpm test --maxWorkers=2` run hit five-second timeout backstops in
`scalingPlanner.test.ts`, `checks/examples.test.ts`, `examples/retry-storm.test.ts`,
`waits.sampling.test.ts` and `retries.noop.test.ts` under shared machine load. No simulation
code, timeout or assertion was changed for this merge.

Only those five specs were run twice against an untouched git archive of origin/master
`643f61b6dc94a64248c8ffd152f69bd979d9ebb4`, extracted inside this checkout's ignored outputs.
The installed root and workspace dependency directories were linked in. The two focused
master runs reported **218 passed / 6 failed** and **217 passed / 7 failed**, with no type
errors; together they reproduce timeout failures in all five specs. No full clean-master
suite was run. Logs are `tests/.output/merge-master-unit-{1,2}.log`.

A focused branch rerun of the same five specs reports **218 passed / 6 failed**, with no
type errors. The full native run also times out in two unchanged `sync.test.ts` policy-reload
cases. Two focused master repeats and the focused branch rerun each pass all **28 tests**
(including type tests), with no type errors. Those sync failures are transient observations,
not an identical clean-master reproduction. Logs are `merge-master-sync-{1,2}.log` and
`merge-sync-recheck.log` under `tests/.output/`.

Continue the existing shared-load unit-backstop investigation without weakening assertions
or increasing timing budgets. Both requested Linux quick-gate attempts were refused at
admission with exit 75 because a live full gate held all 12 worker slots; no test SUMMARY
was produced by those attempts.
