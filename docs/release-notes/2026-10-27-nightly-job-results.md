## Nightly preserves individual job results

Nightly retains the full random-property corpus at 20× runs across four file shards and splits
Linux browser coverage into eight dev shards and twelve production ×3 shards. Both matrices keep
fail-fast disabled. Property shards have a 20-minute test step inside a 30-minute job; Linux browser
shards have a 30-minute action step inside the existing 40-minute job. Step deadlines leave time
to upload diagnostics and report a job failure instead of hitting the job cancellation deadline.
Property artifacts are unique per shard and all feed the failure issue. Successful and failed shards
upload results. Removing workflow concurrency also prevents a newer dispatch replacing a pending run.

The root cause is confirmed by check-run annotations on all nine cancelled jobs in
[scheduled run 40450622788](https://github.com/latchkostov/diagrams/actions/runs/40450622788) and
[manual run 40465623922](https://github.com/latchkostov/diagrams/actions/runs/40465623922): two
property jobs exceeded 10 minutes, and seven browser jobs exceeded 40 minutes. Completed browser
jobs took up to 38.4 minutes; doubling their shards projects about 19 minutes before headroom.
The property log records `waits.review.test.ts` alone taking 376–380 seconds, so file sharding also
needs room for that indivisible slow file. The new budgets are execution backstops, not relaxed test
timeouts or assertions. Native jobs already demonstrate that earlier step timeouts yield failures.

The shared concurrency group had `cancel-in-progress: false`, and every existing matrix had
`fail-fast: false`; neither caused these running jobs to stop. The runs lasted under an hour,
excluding GitHub's six-hour job ceiling. The annotations identify configured job deadlines,
rather than an independent runner step limit. Existing test failures remain failures to fix;
this change neither retries nor disables any tests or jobs.

No application outputs or parity goldens change. Workflow parsing and regression checks validate
the configuration locally; a `workflow_dispatch` on master after merge is the real runner-level
validation. Manual cancellation or infrastructure termination can still cancel a run.
