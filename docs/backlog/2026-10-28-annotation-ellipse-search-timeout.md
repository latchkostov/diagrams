## Annotation search handoff timeout

`tests/e2e/annotations.spec.ts:1014`, “adds from the stencil rail's Annotate group and edits
in the inspector”, sometimes times out at line 1046 waiting for
`data-testid="palette-annotate-shape-ellipse"` after searching for `ellipse` and opening Annotate.

## Clean-master reproduction

Reproduced in this same worktree with a clean detached `origin/master` at
`9cc7d9290d597ab440274aaeeb4d3ea84067a10c`, no changed files, Linux Chromium, production
E2E build, twelve workers/CPUs and zero retries:

```sh
pnpm gate quick tests/e2e/annotations.spec.ts --linux --only e2e --repeat 2 --workers 12 --cpus 12 --max-wait 1
```

First repeat: 53 passed. Second repeat: 52 passed and this same timeout. The performance
branch was restored after the check. No other worktree or full master suite was used.

```text
SUMMARY: 9cc7d9290d597ab440274aaeeb4d3ea84067a10c | unit="not run" parity="not run" e2e={"passed":105,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

The Live performance branch's broader requested-spec run failed this same test once in each
repeat; every other executed case passed:

```text
SUMMARY: d86528578ccd705d5964508e520c0ea1d8c74eb9 | unit="not run" parity="not run" e2e={"passed":918,"failed":2,"flaky":0,"skipped":20} gate_failures=2
```

Reports: `tests/.output/g/rQG2JLm` (clean master) and `tests/.output/g/reVoWo8` (branch).

## Follow-up

Investigate the search-results/Annotate-surface handoff under load. Preserve the ellipse
creation assertion, existing action timeout and test selectors; do not mask it with a retry,
skip or elapsed-time sleep. This pre-existing failure is separate from Live badge rendering.
