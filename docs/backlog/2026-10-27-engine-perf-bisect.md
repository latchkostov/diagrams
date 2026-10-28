## Engine slowdown bisect and checkpoint cost analysis

Diagnosis only. No engine, controller, model, UI, or golden changes. Measured master is
`aa6a4090b9a0e6e6c65c67bb5eeaeabac95976d7` (2026-10-27).

The requested interval reproduces a **cumulative** regression, smaller than the survey's 120%:
`7518737879` → `2c6a463cb0` changes steady playback from **15.21 to 21.58 calibration units
(+41.9%)**, and Run simulations from **27.98 to 44.54 (+59.2%)**. Raw process-median timings
are 136.6 → 192.5 ms and 253.0 → 401.4 ms. These measurements do not reproduce 522 ms or
justify attributing the survey's entire increase to one commit.

The clearest steps are **`e347bd030` (#232, CPU-tail scheduling)** and **`7ccaefe97`
(#237, broker partial-delivery accounting)**. **`61957d3a6` (#228, standalone ledger
accounting)** contributes a smaller, noisier step, particularly to steady playback. The
earlier R4 change also adds cost. Checkpoint copying is a separate replay cost: the measured
saved-simulation path makes **zero structuredClone calls**, while checkpointed replay spends
**14.32% self time in structuredClone**.

## Measurement method and limits

- Windows, AMD Ryzen 9 7950X, Node **24.22.0** through `fnm exec --using 24 --`, pnpm 12.11.2.
  Historical source revisions use the same dependencies installed from measured master's frozen
  lockfile, isolating source changes from dependency/toolchain changes.
- Used the repository's Node Vitest benchmark harness, one fork, exposed GC, no coverage,
  `BENCH_SIZES=500`, `BENCH_FAMILIES=pipeline`, full mode. Each reported process median has
  **five fresh samples per scenario**, including both saved simulations for Run simulations.
  The existing harness uses no saved-playback warm-up; its first sample can be much slower.
- Calibration is the harness's 21-sample fixed JS workload before and after each suite; divide
  each timing by the average of those two readings. Calibration readings span approximately 8.6–11 ms
  here. Calibration reduces host noise; it cannot remove workload-specific contention/JIT noise.
- Started with endpoint/midpoint comparisons, narrowed the first-parent history, then measured
  the engine-changing steps and adjacent parents. Endpoints and the three highlighted adjacent
  comparisons each have **three independent processes**, hence 15 fresh timing samples per
  metric/revision. Tables use the median of process medians; raw and normalized medians are
  computed separately. Intermediate scouting revisions have five samples in one process.
- All benchmark input fingerprints are **`cf8fdfba`**. `pipeline.ts` is unchanged across the
  requested interval. A separate work-count probe confirms steady playback always takes
  **144 outer 100 ms calls, 14,330 simulated ms, aggregate sampled processed count 4,510,
  failed count 4, final in-system count 0** at both endpoints and each highlighted parent/child.
  The slowdown is additional work per step, not a longer steady simulation.
- Run simulations includes the incident too. At #237 its incident changes from 148 calls /
  14,790 ms / failed count 3 to 145 calls / 14,480 ms / failed count 1.55; aggregate processed
  count remains 1,374. This is the partial-delivery correctness change, so its cost comparison
  is end-to-end runtime, not a claim that every internal delivery is identical.
- Node profiles use the inspector at 200 µs, with construction/warm-up outside the profile.
  A diagnostic wrapper also counts/times clones and captures. Those elapsed values include
  instrumentation; use unprofiled benchmark timings for speed comparisons.
- Heap observations below measure the DOM-free LiveController used by Live, in fresh Node
  processes. They isolate engine/controller retention; they do not measure React, DOM, canvas,
  worker, or compositor memory. These measurements need no browser server; parity/gate
  verification runs separately.

Raw part files, logs, JSON readings and CPU profiles remain locally under
`tests/.output/engine-bisect/`. They are ignored, not committed benchmark baselines.
An initial master benchmark overlapped a historical checkout and failed an import; it was
discarded and replaced by the successful `master-clean` run. No mixed-revision result is used.

## Bisection evidence

Scouting medians, in calibration units (cu); a repeated revision uses all three processes.
The order follows the relevant first-parent changes, omitting unrelated commits.

| Revision     | Change                           | Processes | Steady cu | Run simulations cu |
| ------------ | -------------------------------- | --------: | --------: | -----------------: |
| `7518737879` | Good endpoint, R3                |         3 |     15.21 |              27.98 |
| `d217d057f`  | R4 CPU share/callees             |         1 |     16.42 |              29.01 |
| `e9952644a`  | R5 lock-in                       |         1 |     16.65 |              29.88 |
| `b642f42a8`  | Deadlines/timeouts               |         1 |     16.25 |              28.53 |
| `a243a0734`  | Connection pools                 |         1 |     16.81 |              30.72 |
| `7b681d2bd`  | Turnaround lag                   |         1 |     17.07 |              31.25 |
| `55e99b2fa`  | Parent of #228                   |         3 |     16.75 |              31.43 |
| `61957d3a6`  | #228 standalone ledger           |         3 |     18.72 |              32.60 |
| `eb0ae6743`  | Allocation weight                |         1 |     17.95 |              32.42 |
| `6082bfe55`  | Parent of #232                   |         3 |     19.08 |              33.00 |
| `e347bd030`  | #232 fractional CPU tails        |         3 |     20.43 |              35.95 |
| `046bac4a9`  | Checks/agents parity             |         1 |     20.87 |              35.89 |
| `d57634b50`  | Coverage follow-ups              |         1 |     20.31 |              35.74 |
| `4877f5dce`  | Partial-dot plumbing             |         1 |     19.29 |              36.17 |
| `fe57cb0e9`  | Retries/backoff                  |         1 |     20.26 |              36.22 |
| `9781f25f2`  | Immediate parent of #237         |         3 |     20.21 |              36.74 |
| `7ccaefe97`  | #237 broker real-unit deliveries |         3 |     21.53 |              41.96 |
| `5f47cc876`  | Throttle split/settlement        |         1 |     22.75 |              44.51 |
| `dd3893190`  | Circuit breakers                 |         1 |     22.95 |              44.27 |
| `643f61b6d`  | Message types                    |         1 |     22.21 |              43.85 |
| `2c6a463cb0` | Bad endpoint                     |         3 |     21.58 |              44.54 |

Adjacent comparisons, normalized process medians:

| Commit      | Steady parent → child     | Run simulations parent → child | Interpretation                                                                                                                               |
| ----------- | ------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `61957d3a6` | 16.75 → 18.72, **+11.8%** | 31.43 → 32.60, **+3.7%**       | Smaller step; steady ranges overlap (parent 16.42–17.31, child 17.21–18.83). Do not assign a precise fraction of the total regression to it. |
| `e347bd030` | 19.08 → 20.43, **+7.1%**  | 33.00 → 35.95, **+8.9%**       | Both ranges separate: steady 18.58–19.21 vs 20.33–21.06; checks 32.65–33.06 vs 35.82–36.46.                                                  |
| `7ccaefe97` | 20.21 → 21.53, **+6.5%**  | 36.74 → 41.96, **+14.2%**      | Strongest checks step: 36.43–37.85 vs 41.62–43.49. Steady ranges overlap (19.23–21.73 vs 21.14–22.56).                                       |

Endpoint steady process medians span 14.36–19.29 cu on the good revision and 20.64–22.81 cu
on the bad revision; checks span 27.82–28.48 and 44.51–44.96 cu. The larger steady variance
is another reason to keep the survey's 120% separate from this reproduction.

Code paths identified by adjacent diffs, supported by the current profile:

1. **#228:** `executionReservations.ts` expands ledger participation to standalone processors,
   adds cohort/lease lookups, and `engine.tick` changes admission/service-pacing gates to `waits()`.
   These hooks sit in the per-node/per-work path. This benchmark has no planning revision; much
   of the new machinery is inactive, but its branching/call overhead remains. Exact costs within
   that commit need an allocation/operation-count follow-up, not a correctness rollback.
2. **#232:** the per-node tick creates `chargeTailCpu`/`yieldsCpu` closures and empty `yielding` /
   `tailsAfter` arrays even when there is no resource CPU budget/tail. Current master moved part
   of this into `engine/resources.ts::prepareCpu`; it remains visible in saved playback's profile.
   An inactive-resource fast path is the first optimization candidate.
3. **#237:** `shareOut`/partial deliveries, `dotsOf`, `workingUnits`, queue/staged/incoming units,
   and working-set recounts add broker/processor bookkeeping. The pipeline exercises this
   directly. Its sampled deliveries must retain the real-unit behavior; optimize the common
   whole-delivery path and redundant accounting, not the fractional result.

These are cumulative sources, not three independently additive percentages. Later scout movements
within the noise are not evidence that retries, breakers, or message types caused a new large step.

## Current-master profiles at 500 nodes

Unprofiled `master-clean`: steady **186.72 ms / 20.86 cu**, Run simulations **392.42 ms /
43.52 cu**, engine load **3.50 ms / 0.39 cu**. Five saved/checks samples, 15 engine-load samples.
Master has not recovered the requested interval's regression, but neither reproduces 522 ms here.

Saved profile: twelve complete steady runs, 2,379 ms elapsed. Replay profile: twelve backward
seeks to 15 s and forward seeks to 60 s on a 360 s steady scenario, Traffic ×10 at fixed scale 5,
with checkpoints enabled; 28,303 ms elapsed. Construction and the initial seek to 60 s are excluded.
Percentages below are self time divided by all sampled time, including GC.

| Function               |   Saved self | Checkpointed replay self |
| ---------------------- | -----------: | -----------------------: |
| `engine.tick`          |       46.20% |                   21.99% |
| `engine.step`          |       15.79% |                   11.10% |
| `resources.prepareCpu` |        7.13% |                    2.41% |
| `admitPendingPass`     |        5.55% |                    4.44% |
| `broker.pull`          |        4.53% |                    3.44% |
| `trafficArea`          |        2.20% |             below top 15 |
| Garbage collector      |        1.90% |                    4.43% |
| `admitIncoming`        |        0.83% |                    3.33% |
| `structuredClone`      |    **0.00%** |               **14.32%** |
| `travel`               | below top 15 |                    2.36% |
| `complete`             | below top 15 |                    2.05% |

Replay inclusive shares: `captureCheckpoint` **13.80%**, `cloneGraph` **14.58%**, clone calls
**14.45%**, restore **1.00%**. These overlap; do not add them. Capture includes observing health,
runner and engine copying, and storing the token. CloneGraph also executes during restoration.
Direct counters recorded **108 captures**, **6,276 clone calls**, **3,963 ms** in capture calls,
**4,147 ms** in all clone calls, **3,864 ms** cloning inside capture. Small clones account for
many calls; call count is not a proxy for bytes copied. Saved playback recorded **zero captures
and zero clones**.

The previous [G4 profiles](2026-10-25-timeout-triage.md) measured 26.0% and 35.7% clone self time
on tutorial/decorations replay. This @500 pipeline run measures a different workload on newer
master, which already shares lineage recordings and copy-on-write latency recorders in `cloneGraph`.
It does not invalidate G4 or establish that all replay costs 14%.

## Five-minute retained-heap experiment

All four fresh-process runs passed, each paced for 300 wall seconds / 300 simulated seconds,
Traffic ×10. Two GCs precede every heap reading. Saved arms use scale 5; Free play uses its
original automatic scale (10 at 500 nodes, 20 at 1,500). Absolute heap includes the loaded
Vitest/module graph, so compare growth and arms, not browser absolute heap.

| Simulated seconds                       | Saved @500, ring on (MiB) | Ring tokens | Saved @500, capture off (MiB) | Free play @500 (MiB) | Free play @1500 (MiB) |
| --------------------------------------- | ------------------------: | ----------: | ----------------------------: | -------------------: | --------------------: |
| 0                                       |                     28.24 |           1 |                         25.64 |                25.49 |                 33.81 |
| 60                                      |                    116.62 |          13 |                         33.03 |                32.85 |                 50.45 |
| 120                                     |                    220.65 |          24 |                         33.81 |                35.01 |                 55.58 |
| 180                                     |                    269.22 |          24 |                         35.95 |                37.01 |                 60.39 |
| 240                                     |                    313.12 |          24 |                         37.03 |                39.22 |                 64.20 |
| 300                                     |                **357.78** |          24 |                     **38.46** |            **40.94** |             **68.82** |
| After releasing ring, same 300 s engine |                 **39.53** |           0 |                         38.34 |                40.83 |                 68.68 |

Saved growth is **329.54 MiB with capture versus 12.82 MiB without**. Releasing the retained
tokens in the same live controller frees **318.25 MiB (89% of its final heap)**, without
advancing/resetting the engine. All **11 timed full-snapshot SHA-256 values match** between
the on/off arms, as do the two cleanup readings. This is direct causal evidence for ring
retention, not a difference in simulated outcomes.

The ring reaches 24 tokens at 120 s, but its heap still grows another **137.13 MiB** by 300 s.
Both saved arms finish with in-system count **37,287**: this overloaded run keeps accumulating
work, so later checkpoints are larger. **A token-count cap does not bound bytes.** The final
between-process gap is 319.32 MiB; the same-process release is the stronger ownership check.
The remaining ~1.2 MiB arm difference after release is not evidence for leaked checkpoint graphs.

Free play captures **zero tokens throughout**, yet heap grows **15.45 MiB at 500** and
**35.01 MiB at 1,500** over five minutes. In-system counts grow to 72,273 and 153,676.
This experiment therefore does not establish a leak: it includes JIT/warm-up, bounded histories,
and an increasing overloaded workload. A drain/exit retained-object comparison is the next
memory diagnostic for that path.

**Verdict:** the ring is the dominant saved-Live retention cost here, but **cannot cause the
nightly `live/heapLiveGrowth60s/pipeline@1500` trend as currently implemented**. That browser
benchmark calls `goLive()` into Free play, never selects a simulation, and never captures a ring
(`captureCheckpoint` returns when `runner` is null). Its one-minute/default-traffic/browser
measurement differs from this five-minute/x10/Node experiment. Investigate its backlog/history,
rendering snapshots and browser resource ownership separately; do not label the reported
1.2 → 4.8 MB trend a checkpoint leak.

## Proposed fix sequence and independent sweep boundary

Estimates below are hypotheses or arithmetic ceilings, not implemented speedups. Keep each engine
change separate and compare both target metrics at 500 plus checkpointed replay before/after.

| Proposal                                                                                    | Estimated win                                                                                                                                                                 | Risk and required evidence                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Avoid inactive CPU/ledger allocations and repeated invariant feature checks in hot ticks    | Target **5–10% saved-playback runtime** initially; `prepareCpu` alone has 7.13% self share. The #232 adjacent step is 7–9%, but not all of it is removable.                   | Medium: cache invalidation after live resource/revision edits and admission phase order. **Independent fc-sweep required**, CPU/ledger/sampling invariants, live-edit and same-arrivals cases; operation-count guard for inactive resources.                                                                                                                                  |
| Optimize whole-delivery broker/unit bookkeeping while retaining partial delivery semantics  | Target **5–10% Run simulations runtime**; #237 adds 14.2% in the repeated checks comparison, an upper bound on recovering that step.                                          | Medium/high: weights, prefetch, stages, ack/retry and scale changes share accounting. **Independent fc-sweep required**, broker/sampling/conservation tests and same-arrivals comparison. Never recover speed by restoring rounded dots.                                                                                                                                      |
| Cap retained checkpoint count/bytes, preserving origin and recent positions                 | At an otherwise identical state, 24 → 8 similarly sized tokens means about **two-thirds less ring retention**. Merely dropping tokens saves essentially no capture CPU.       | Medium: older backward seeks replay farther and may become slower. Controller-only policy needs paused seeks, boundary/branching, health continuity, trace intent, cancellation, and same-seed replay tests; engine capture-format changes additionally need the **independent fc-sweep**. Select a byte cap from measured retained sizes, not guessed serialized JSON sizes. |
| Increase capture interval or adapt it to measured state size/replay distance                | 5 s → 15 s removes about two-thirds of periodic capture work: at most **~9 percentage points** from this replay's 13.8% capture share, before extra replay work.              | Medium: seek latency may erase the gain; preserve the origin and bound reconstruction work. Measure forward playback and arbitrary backward seeks separately. No engine sweep for a strictly controller-only policy; **sweep required** if engine snapshot/restore changes.                                                                                                   |
| Incremental checkpoints with bounded full anchors                                           | Potentially remove much of the **14.3% clone share** and repeated static graph retention; actual win depends on dynamic-state churn. Keep delta chains bounded.               | High: aliases/cycles, message/group/ledger identities, RNG/clock, topology epoch and partial-unit counters must restore exactly. **Independent fc-sweep required**, checkpoint identity/ownership, refusal no-op, restore-twice and branch-replay tests. No golden changes expected.                                                                                          |
| Extend structural sharing of immutable topology/config and use copy-on-write dynamic slices | Potentially large ring-memory reduction; this profile's **14.3% clone share is the direct CPU ceiling**, before GC effects. Existing trace/latency sharing must be preserved. | High: accidental sharing of mutable messages, group queues, ledgers or node props corrupts retained checkpoints. Establish ownership/write barriers first. **Independent fc-sweep required**, identity and mutation-isolation tests, same-arrivals/output parity.                                                                                                             |
| Avoid redundant clone/restore calls in replay callers                                       | Saved steady has **zero clone budget to recover**. Replay savings are bounded by the measured clone share; restore alone is only 1.0% inclusive here.                         | Low/medium for eliminating proven duplicate controller work; high for changing engine ownership. Count calls and assert restore equivalence. Any engine `cloneGraph`, capture or restore edit needs the **independent fc-sweep**.                                                                                                                                             |

First follow-up: quantify empty CPU-path allocations and add the inactive fast path in its own
engine PR. Second: a controller-only checkpoint policy with explicit seek-distance coverage.
Only then pursue incremental capture/structural sharing if the memory and replay measurements
justify that complexity. An independent reviewer runs `scripts/fc-sweep.mjs` at the engine PR's
final commit, with the agreed ordinary/heavy seeds and multipliers; include its exact summary,
failed seeds and clean-master exceptions. This diagnosis does not substitute for that sweep.

Rejected for this task: changing engine behavior, reverting sampling corrections, JSON-based
cloning (loses Map/Set/alias/cycle semantics), updating goldens to hide differences, assigning
all heap growth to checkpoints without checking Free play, and implementing speculative
structural sharing before measuring retention. No output golden is changed or re-recorded.

## Reproduce

Run one revision at a time in this worktree, wait for completion before switching, then restore
the branch. Keep dependency versions fixed for a source-only bisect. Do not run benchmark
timings beside other heavy jobs. The diagnostic test is skipped unless explicitly enabled.

```powershell
$env:BENCH_SIZES='500'
$env:BENCH_FAMILIES='pipeline'
$env:BENCH_MODE='full'
$env:BENCH_OUT='tests/.output/engine-bisect/<revision>-<round>'
fnm exec --using 24 -- node node_modules/vitest/vitest.mjs run --config tests/bench/vitest.config.ts tests/bench/node/sim.bench.ts tests/bench/node/checks.bench.ts -t '^(saved simulations|Run simulations) pipeline@500$'

$env:ENGINE_DIAG='work' # exact saved-playback work counts
$env:ENGINE_DIAG_OUT='tests/.output/engine-bisect/<revision>-work'
fnm exec --using 24 -- node node_modules/vitest/vitest.mjs run --config tests/bench/vitest.config.ts tests/bench/node/engineDiagnosis.bench.ts

$env:ENGINE_DIAG='profile'
$env:ENGINE_DIAG_OUT='tests/.output/engine-bisect/diagnosis'
fnm exec --using 24 -- node node_modules/vitest/vitest.mjs run --config tests/bench/vitest.config.ts tests/bench/node/engineDiagnosis.bench.ts
fnm exec --using 24 -- node scripts/bench/engine-profile-summary.mjs tests/.output/engine-bisect/diagnosis/saved.cpuprofile tests/.output/engine-bisect/diagnosis/replay.cpuprofile

$env:ENGINE_DIAG='memory'
$env:ENGINE_DIAG_RING='on' # repeat with off and free, each in a fresh process
$env:ENGINE_DIAG_N='500' # also measured free at 1500
fnm exec --using 24 -- node node_modules/vitest/vitest.mjs run --config tests/bench/vitest.config.ts tests/bench/node/engineDiagnosis.bench.ts
```

The `off` arm replaces only the diagnostic controller instance's capture method before selecting
the saved simulation. Engine source and stepping stay identical. `free` uses real Free play,
with Traffic ×10 at its original automatic dot scale. Saved arms extend the generated steady
traffic/duration to 360 s at Traffic ×10, fixed scale 5. Frames advance at 60 Hz, publish every
eight frames, and are paced to wall time for five minutes. Every 30 s collects GC twice and
records heap, ring length, counters and the full snapshot SHA-256. After 300 s the helper releases
the ring and collects again to distinguish ring retention from the live engine itself.

## Verification

The calibrated source comparisons, eight work-count probes, current-master saved/replay profile,
and all four five-minute memory arms completed successfully. One invalid overlapping-checkout
master probe failed an import and was discarded; its replacement passed all three selected
benchmark cases. No application fix was attempted, so there is no fix/revert regression test.

`pnpm parity` passed: **1,873 Node assertions, 110 Linux browser tests; 3,178 goldens,
0 changed, 0 added, 0 missing, 0 stale**. Typecheck and the focused helper lint passed during
preparation. The final lint, typecheck and whole-repository Prettier checks run immediately
before the signed commit. The post-commit full gate's exact summary belongs in the PR report;
the engine fc-sweep is intentionally deferred to the separate engine fix.
