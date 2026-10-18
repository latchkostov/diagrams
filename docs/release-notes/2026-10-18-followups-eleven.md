## Follow-ups eleven

Custom injection now sends opening focus and boundary Tab moves through the interaction controller.
Every close returns to the originating node, independent of the closing context menu's timing.
Outside dismissal cancels the pointer's pending default focus so it cannot override that return.
The form's fields, natural Tab order, inert background and actions stay the same.

The typing responsiveness regression starts scheduled checks explicitly during its measured work,
avoiding repeated debounce waits while preserving all 21 matched pairs and the 1.5 ratio. Fixture
restoration reuses only the previous real worker result for an identical document; every measured
running input must post to the real worker. Both members still start with fresh findings, and worker
results publish after each CPU sample. Video-layer checks acknowledge page changes in the actual
captured pixels, rather than treating elapsed time or repeated old frames as readiness. Their
alternating marker recognizes colour-converted pixels without changing any layer assertion.
Exact recording-duration checks use an installed, controlled page clock with the real encoder.

Nightly 39137867503's two typing failures exhausted the existing whole-test backstop before a
ratio verdict. On clean master, two Linux runs passed with ratios 1.138 and 1.000; the first took
107.8 seconds of the unchanged 120-second backstop. The harness change targets its repeated
quiet-time waits and duplicate prefix work, without changing production scheduling or the responsiveness threshold.
The first fix round still exceeded that backstop under load while recomputing restored prefixes.
The second preserved all assertions and passed both four-worker/two-CPU runs: 70.4 and 68.2 seconds,
ratios 1.174 and 1.281, all 21 real measured runs each, with no result published during sampling.

Quick gates pass related paths in a JSON file, including the Linux container configuration, so
large changes no longer expand the Windows command line. The quarantine-override regression
exercises the real proxy and checks that unrelated fixme calls still delegate.

## Verification

- Native Windows, four-core process affinity and three workers: the exact 13-case failure inventory
  plus the whole live-view spec twice, 90 passed, zero failed, flaky or skipped (`rpKWuBX`).
- The actual Nightly quarantine override executed all four target bodies three times: 12 passed,
  zero failed, flaky or skipped (`rq8Bc1M`).
- Second Linux fix round: typing twice, eight real layer-capture cases and all modal regressions
  passed. Three older live-view cases hit whole-test backstops in its first invocation; its second
  invocation passed all 49 cases. Clean-master comparison and the full loaded batch follow.
- Full unit suite: 10,781 passed, four existing skips; production build and entry budget passed.
  Linux related tests passed 466 before the final extraction. The extracted harness regressions
  passed with their intentional broken implementations rejected.
- Full parity checked all 2,386 goldens with zero changed, added, missing or stale. No golden is
  re-recorded. Final branch and loaded-gate results are recorded after clean-master triage.
