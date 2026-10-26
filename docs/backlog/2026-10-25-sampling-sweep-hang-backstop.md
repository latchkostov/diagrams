## Pre-existing sampling sweep timeout at 20x

The checkpoint-boundary sweep hit the existing 40,000 ms hang backstop in
`src/sim/waits.review.test.ts`: `sampled callers preserve non-divisible pool capacity:
generated scales for 1 slots`, seed `-53728651`, `FC_RUN_MULTIPLIER=20`, Node 24.22.0.
No fast-check counterexample or failed capacity assertion was reported.

Initial sweep result: `SUMMARY: 42 passed, 1 failed, 5 unrun; 2726.13s`.
The timeout case took 40,473 ms on the checkpoint branch.

Only the failing spec was repeated twice in a clean source archive of origin/master
`31aa4f4b51e9f729187bb481447986bc364d7980`, with the identical seed, multiplier and CI
configuration. Both repeats failed the same test with `Test timed out in 40000ms`:
36 passed and 1 failed each; complete-spec durations were 246.62 s and 257.10 s.
This establishes the same pre-existing failure without running a master full suite.

Keep the generated inputs, multiplier, assertions and timeout unchanged in this refactor.
Investigate the hang backstop separately under the mandatory three-job sweep load; preserve the
non-divisible capacity and one-percent throughput contracts. Timeout runs remain failed evidence,
not passing seeds. Completion/replay reports are retained with the checkpoint PR's local sweep outputs.

A final-module completion attempt retained both 20x failures:
`SUMMARY: 0 passed, 2 failed, 0 unrun; 340.35s`, for seeds `-53728651` and `-723400938`.
Both timed out in the same generated-scale, one-slot test. Two other 20x seeds passed in the
initial sweep. All four required heavy seeds were therefore attempted, with these two timeout
exceptions kept visible. The four pinned 5x seeds and final-adapter seed replays run separately;
the PR reports their completion summary without relabeling either timeout as a pass.
