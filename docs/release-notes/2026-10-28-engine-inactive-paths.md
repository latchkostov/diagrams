## Skip inactive CPU and ledger work in engine ticks

Engine ticks skip CPU scratch preparation, tail finishing and resource integration when a node has
neither an active resource model nor CPU tails. Empty ledgers skip release/credit maintenance.
The waiting revision capability is computed once per graph load.
Admission order, CPU sharing, sampling, reservations and simulation outputs are unchanged.

Resource presence and ledger ownership are read from current state, rather than cached: live edits,
restarts and checkpoint restores immediately select the appropriate path. Revision capabilities
survive restarts/restores within the same topology and refresh before compiling a newly loaded graph.
Tests cover inactive ticks with and without waiting enabled, active traffic, resource enable/disable,
restoration in both directions, graph revision changes and ledger activation/drain/restoration.
Temporarily restoring the original engine makes five of the six regression cases fail; restoring
the fix passes all six. Empty tail finishing also avoids its scratch array. Test-only CPU charge
payloads fold out of production, preserving the existing bundle and skill reserves. A strengthened
bundle test rejects those payloads; temporarily reverting the fix makes it fail on `logicalBefore`.

## Measurements

Windows, Ryzen 9 7950X, Node 24.22.0, source baseline `70a5a06aa`. Existing Node benchmark harness,
`BENCH_SIZES=500 BENCH_FAMILIES=pipeline BENCH_MODE=full`; three fresh processes per arm, five
samples per scenario, no concurrent heavy jobs. Values are medians of process medians; raw and
calibration-normalized medians are computed separately. Calibration uses the average of the
harness's start/end readings. Workload fingerprint remains `cf8fdfba`.

| Metric at 500 nodes   | Before ms |  After ms | Before cu | After cu | Raw reduction | cu reduction |
| --------------------- | --------: | --------: | --------: | -------: | ------------: | -----------: |
| Saved steady playback |   193.286 |   154.071 |    22.035 |   17.349 |        20.29% |       21.27% |
| Run simulations       |   369.237 |   285.326 |    41.600 |   32.181 |        22.73% |       22.64% |
| Checkpointed replay   | 1,797.510 | 1,626.232 |   205.138 |  188.492 |         9.53% |        8.11% |

Replay uses the bisect diagnosis's 360 s steady scenario at Traffic ×10, scale 5, with the real
checkpoint ring enabled. After an initial seek to 60 s, each sample seeks backward to 15 s and
forward to 60 s, including checkpoint capture/restore. One untimed pair precedes five samples.
Replay's final full-snapshot SHA-256 matches across all six processes. This is a workload-specific
improvement, not a browser performance claim. Both target metrics exceed the required 3% threshold.

The untimed census records 1,433 steady ticks. Before: **716,500 inactive CPU calls**, **716,500
ledger release calls**, **716,500 credit-expiry calls**, **801,406 revision checks**. After: **zero**
for each. Every tick previously executed 500 inactive CPU calls, creating 1,000 closures and 1,500
arrays: **3,582,500 explicit scratch allocations** over the run, now zero. These allocation counts
are derived from the executed inactive bodies (two closures, three arrays per call), not sampled
heap bytes. The census's final snapshot SHA-256 is identical before/after.

Raw benchmark parts, operation counts, replay hashes and the comparison JSON remain in the ignored
`tests/.output/engine-fast-path/` directory. Reproduce the census with `ENGINE_DIAG=inactive` and
replay with `ENGINE_DIAG=replay`, setting `ENGINE_DIAG_OUT` to a fresh directory and running
`tests/bench/node/engineDiagnosis.bench.ts` with `tests/bench/vitest.config.ts`.

## Scope and output parity

No simulation, parity or same-arrivals golden is changed or re-recorded. No budget or reserve is
raised. Broker partial-delivery bookkeeping and `admitPendingPass` remain for engine fix 2: neither
needs to change to obtain this measured win. Checkpoint format and retention policy stay as they are.
The independent fc-sweep belongs to the orchestrator and is not run by this change.

Initial reserve checks failed on the candidate and passed twice on clean `origin/master` at
`70a5a06aa`. Removing production CPU diagnostic payloads fixed both reserve failures without changing
their limits. The per-tick early-pool wake set and load-only retry revision checks remain: avoiding
them added emitted code without a meaningful isolated win. More extensive CPU helper refactors and
fleet-scan consolidation were discarded; they were unnecessary for this fast path and its reserves.

## Verification

Simulation and Live units: 2,382 passed, five expected-fail cases and one skip. Full parity:
1,873 Node assertions and 110 Linux browser tests; **3,178 goldens, 0 changed, 0 added, 0 missing,
0 stale**. Production build, entry/viewer/Forge sizes, regeneration and i18n validation passed.
The heavy suite includes engine/sampling/same-arrivals, checkpointed Live, startup split and both
unchanged reserve checks. The new operation and bundle regressions were also verified by temporarily
restoring the original source, then restoring the fix.
