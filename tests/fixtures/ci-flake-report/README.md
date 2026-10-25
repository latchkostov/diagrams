## Frozen flake-report evidence

`interrupted.log` records Playwright 1.64.1's line reporter with two concurrent tests:
one assertion failure and one pending promise interrupted by `maxFailures: 1`.
No browser or server was needed. Paths are normalized to a generic E2E spec and fixed
Actions timestamps are added; code excerpts, local paths and process warnings are omitted.
The tests also substitute the two cancellation spellings and truncate before the final summary.

`repeated-interrupted.log` replays that recorded failure/interruption with Actions error and
notice annotations before and after its detail block and after its summary. Repeated headers
use different line numbers and reporter decoration while keeping the same test identity.
Tests read the full log, the details before the summary, and the summary alone, and substitute
both cancellation spellings. The fixture is fixed; regression tests make no `gh` or network calls.

`rerun-snapshot.json` is a reduced, fixed snapshot in the collector's runs/jobs API shape:
two complete successful attempts, a later single-shard rerun, and an older workflow run.
Its deliberately different durations identify which attempt supplies the comparison.
Tests consume these fixtures without GitHub calls.

`actions-rerun.json` records the E2E job metadata from both attempts of
[CI run 40160789032](https://github.com/latchkostov/diagrams/actions/runs/40160789032),
collected on 2026-10-25 via the run and attempt-jobs APIs. Only fields used by the
report are retained. The regression models a later attempt without E2E jobs and
checks that the recorded complete attempt and its wall times remain available.
