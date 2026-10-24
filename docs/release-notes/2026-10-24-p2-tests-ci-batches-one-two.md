## P2 tests and CI: batches 1–2

Nightly now runs the Firefox/WebKit canvas gesture regressions against a production E2E build,
using browsers pinned by the lockfile, and uploads their results and traces for the failure report.
Self-host smoke diagnostics stop waiting after a shared deadline so a hung renderer cannot block
browser/container cleanup. Deployment smoke creates/removes Docker networks during browser and
context startup. Self-host CI no longer installs unused native Chromium or its system libraries.

The flake ledger's slow-motion title has its literal Unicode restored and is checked against actual
spec declarations. Native runner evidence and all 17 historical Windows/macOS failures are inventoried
in [the evidence fragment](../backlog/2026-10-24-p2-native-evidence.md). Evidence collection does not
claim unresolved native defects fixed or lift the four quarantines. The generated inspector race
already has a fix and held-identity regression in #275.

Slow-motion Retry coverage controls the replay clock and checks both startup and final completion.
The tint regression waits for the lazy description's layout before clicking Colour; the original
trace failed before the picker opened, not during Undo. Its exact tint/persistence checks stay intact.

No application output changes are intended. No parity golden is changed or re-recorded.

## Verification

- Targeted unit checks: 50 passed across eight files.
- Final production E2E checks: all 71 cases in the three affected spec files passed in each of
  five Linux repetitions, with eight workers/eight CPUs: 355 passed, zero failed/flaky/skipped.
- The initial Linux run had one Retry failure because the controlled clock advanced too few
  capture frames per observation. Correcting that advancement, without changing the timeout or
  assertion, produced the final five passing repetitions.
- Seven controlled removals fail their regressions: description readiness, identity readiness,
  Retry clock control, ledger title, workflow changes, diagnostic deadline and startup probe.
- A real isolated-browser Docker smoke created/removed bridges during both startup phases,
  loaded the page successfully and returned through browser/container cleanup. The canvas config
  lists the expected four Firefox/WebKit cases; execution of the new scheduled job remains in CI.
- The task requests targeted tests only. Full suites, the full gate, standalone size checks and
  output parity are left to CI; no golden was re-recorded.

```text
SUMMARY: d9304926dcb636f0d8a7012f4592c80b7e0ca235 | unit="not run" parity="not run" e2e={"passed":355,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
