# Simulation truth: second review fixes

Triage of `.reviews/20261013-222349/REPORT.md` for PR #87. All findings are valid. The architecture and performance
findings about travel-time rescanning describe the same defect and share one fix and regression.

| Finding                                | Change and regression                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inert sink latency throttles topics    | Immediate-arrival roles have unlimited delivery allowance; saved latency and unset latency produce identical seeded runs.                                            |
| Travel-time rescanning (two findings)  | Each group indexes maximum travel time per consumer at load; scale-change complexity compares an input with eight times as many consumers, below 24× growth.         |
| Outage membership scans                | The watcher indexes consumer-to-broker/group memberships once per diagram; outage observation has the same linear complexity regression.                             |
| Checkpoint dictionary prototypes       | Staging and held-slot state use Maps; cloned active-slot dictionaries regain a null prototype. Checkpoints round-trip consumers named `constructor` and `__proto__`. |
| Unrelated capacity diagnosis hides lag | Suppression matches the lagging broker or its group members; an overloaded independent path cannot hide the warning.                                                 |
| Live region mounts populated           | An empty region stays mounted; an effect changes its text only when the announcement changes. E2E verifies the same region before and after trouble.                 |
| Short runs miss losses                 | Loss detection precedes the long-history trend guard; a 1,800 ms run reports its first drop.                                                                         |
| Seek ends ongoing lag                  | Insufficient history cannot confirm a trend ended; a controller forward-seek regression warms the history and gets the same warning back.                            |
| Reading consumes display history       | The getter reads a cached selection. Controller publications observe trouble; a mounted callout acknowledges display. Hidden outages keep their turn.                |
| Outage classifications disagree        | The compiled flow routes share a broker-fed classification across trouble, capacity and checks; down brokers can wait upstream.                                      |
| Title-card overlap                     | Both floating callouts use the measured room beside the title, or sit below it. Production E2E checks bounds at 1440 with the AI panel and the narrow fallback.      |
| Remove loses inspector focus           | Removal transfers focus to a surviving disclosure or field; E2E covers node and edge settings.                                                                       |
| Flat backlog reported rising           | Require positive growth in a recent interval; a sustained plateau never triggers lag trouble.                                                                        |
| DLQ eval accepts ordinary routes       | Score the compiled route classification; explicit false and ordinary queues fail, explicit and inferred DLQ routes pass.                                             |

No correctness finding was rejected. Rejected alternatives: revealing sink latency would expose a setting whose
processing semantics are immediate; millisecond performance budgets would depend on the machine; consuming a
warning while hidden would prevent its first useful display. Existing once-per-run dismissal behavior stays.

Regression verification temporarily restores the original engine and UI implementations, and individually removes
the watcher/scorer fixes, then restores the fixed sources. Tests must fail on the reported behavior, not on imports
or type errors. The local logs remain alongside the review report.

## Validation

- Rebased onto `origin/master` with #89. Only the generated viewer conflicted; it was rebuilt from the combined
  sources with `pnpm skill:release`. Plugin version is 1.1.6; `pnpm skill:check` passes.
- Typecheck, lint, format, i18n, build and entry-size checks pass. i18n retains existing catalog warnings with no
  errors. Entry gzip is 103.5 kB against a 123.5 kB budget.
- Unit suite: 446 test files, 5,307 tests passed, four skipped; no type errors. The startup chunk regression passes.
- Production Chromium on explicit ports 6050–6054: live, live-render, capacity, slowmo, sim-truth,
  sim-clarity and network-devices have passing results. The first combined run passed 101 and failed the new
  hidden-Inputs test because its recovery-marker selector was wrong. A rerun exposed interception of the status
  marker by its note; selecting the visible recovery note fixes the test. Final sim-truth run: all 14 passed,
  including the additional first-mount and capacity-callout geometry checks (103 distinct passing tests).
- Coverage audit caught that Checks is split into `checks-agent`, `checks-rules`, `checks-simulations` and
  `checks-ui`, rather than `checks.spec.ts`. Running all four passed 28 tests and failed the existing typing
  responsiveness assertion at 80 ms against its 48 ms same-run baseline limit. The unchanged test then passed
  three isolated runs with one worker. That suggests parallel browser contention; the initial failure remains
  recorded, and no threshold was weakened. All requested areas now have passing results, totaling 132 distinct
  tests across 11 spec files. No automatic retries were enabled.
- Initial lint included two temporary local verification scripts; those scripts were removed and lint passed.
  The deliberate reversion runs failed as expected for every reported defect. The restored fixes pass.
- Designer UX gate: no remaining source finding, no extra chrome; production checks cover focus and actual bounds.
