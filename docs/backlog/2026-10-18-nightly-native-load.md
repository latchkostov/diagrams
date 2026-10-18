## Windows slow-motion context-close stalls

## Runner evidence collection

Nightly's report-only `slowmo-teardown-diagnostic` job now runs these four cases on
`windows-latest`, unquarantined only under its explicit diagnostic opt-in, three times
with zero retries. Artifact `nightly-slowmo-teardown-evidence` contains failure traces,
browser-process logs, gate summaries and per-test `teardown-probe.jsonl` files. The probe
logs page handle/resource snapshots before context close, pending network requests,
worker shutdown and context-close begin/end. Main-thread handles are observed; worker
internal timers are outside the probe. Its local Windows dry run passes all 12 cases;
wait for original-runner evidence before changing the quarantines.

## Original failures

Four Windows-only quarantines from Nightly 39115946465 remain. The cold-load
cases from the same inventory are addressed by the follow-ups nine readiness
changes; the slow-motion cases have no established causal fix.

| Test at the Nightly revision      | Original evidence                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `slowmo.spec.ts:65`               | Test and context teardown each exceeded their 30 s backstop; its trace is incomplete.  |
| `slowmo.spec.ts:108`              | Ordinary actions and disabled-control checks finish slowly, then context close stalls. |
| `slowmo.spec.ts:271`, fitted only | The trace reaches viewport restoration, then context close stalls.                     |
| `slowmo.spec.ts:297`              | The recording-options path is followed by a context-close stall.                       |

## Native investigation on 2026-10-18

Both investigation rounds run natively on Windows, restricted to four logical
CPUs (`0xf` affinity), three browser workers and production E2E builds. The first
uses one competing CPU process and repeats all slow-motion cases with the AI,
checks and lazy-load neighbours five times (`tests/.output/g/r8XXfet/`: 305 passed,
zero failed or flaky). The second uses two competing CPU processes, repeats the
four unskipped cases with the cold-load regressions five times, and records worker
closure and outstanding requests (`tests/.output/g/rsTrNzD/`).
That second round passes all 115 cases, with zero failures, flaky cases or skips.
Each of the four target cases passes ten native repetitions across both rounds.

All 20 target contexts in the second round record every created worker closing
and no outstanding requests. These four cases never start a MediaRecorder. Source review
also finds the frame loop cancelling its animation callback and disposing its
renderer on unmount, and slow-motion look-ahead cancelling its callback on dispose.
These observations do not establish a cleanup defect behind the original stall.

The four original failures belong to four worker indices. The fitted restoration
case is its worker's first recorded test; the predecessors of the first two
failures are routing and axe cases, rather than recording. A preceding recording
in the same worker therefore does not explain all four failures.

The original downloaded traces show seconds spent in ordinary locator calls and
module requests, in addition to stalled context teardown. For example, LiveSession
loads take about ten seconds in two of the slow-motion traces. The trace evidence
therefore does not isolate product rendering, native serving or trace finalization.

Keep the four `test.fixme` annotations: passing native repetitions without a
reproduction or causal fix is insufficient to lift them. No timeout, assertion,
retry count, recording semantics or playback cleanup is changed. The manually
zoomed restoration case remains enabled. Capture browser-process and preview
request diagnostics on the original small Windows runner before its context-close
backstop, separating pending requests from worker shutdown and trace packaging.
