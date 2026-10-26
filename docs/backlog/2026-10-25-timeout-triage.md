## Timeout triage: sweep and heavy tests (lane C, 2026-10-25)

**`-53728651 ×20` is (c), load-sensitive, with a large but finite workload.** The unchanged
one-slot property passed twice in isolation (19.172 s and 20.394 s). A test-local copy completed
all 400 evaluations, all assertions and all 800 engine drains: **10,542,400 internal 10 ms ticks**.
No liveness failure or invariant counterexample was found. Historical 40-second failures remain
failures; an isolated pass does not erase them or prove which competing process caused them.

This investigation read all 19 current `*timeout*` / `*hang-backstop*` fragments, plus three related
backoff verification fragments. Their complete reports are preserved below and replace the individual
files. The sampling report named in the brief is absent from this baseline; its complete report was
recovered read-only from commit `91185272b092e1cdfe0d8b6c4b271cc72abd65d4` and is preserved too.
The older [native-load consolidation](2026-10-23-native-load-backstops.md) remains separate.

Diagnosis baseline: clean `e5dac41b22235302983cfb3d46409d8a0560d9cb` (also fetched origin/master),
Windows, Node 24.22.0, frozen pnpm 12.11.2 dependencies, one Vitest worker, no coverage.
No engine, test, timeout, sampling count, seed, assertion or golden changes are proposed for this PR.
Temporary profiling helpers were outside `src/sim/` and removed after diagnosis. All fixes below
are proposals, not claims of resolution. There is no product/UX or output change.

## Groups, causes and owners

Categories: **(a)** failure to make progress; **(b)** finite work that is intrinsically slow;
**(c)** passes in isolation but exhausts a backstop under other workload. Every observed family
has evidence of (c); the profiles explain its finite CPU cost. For browser and Git cases this is a
**provisional scheduling classification**, not an established root cause. No report establishes (a).
Only the resolved slow-motion case is marked resolved.

| Group                                                                          | Class                            | Evidence / cost                                                                                                                                                                                                                                                                                               | Proposed fix and owning lane                                                                                                                                                                                                                                                                                                                                                                   | Wait for engine split PR 5?                                                                        |
| ------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| G1: generated non-divisible pools                                              | **c, measured**                  | Exact one-slot seed passes at 19.172/20.394 s; 400 evaluations execute 10.54 million ticks. Baselines account for about 66% of instrumented time. Earlier one-slot ×20 failures reach 40 s; two-slot rechecks pass.                                                                                           | **Lane C:** partition the unchanged generated stream into independently reported work, or prove deterministic baseline reuse with mutation checks. Keep every generated input, explicit example, pool observation, drain and 1% comparison. **Engine owner after lane B:** profile inactive tick/admission work before optimizing.                                                             | **Yes** for `step`/`tick`/ledger changes; no for separately reviewed test organization.            |
| G2: sizing and checks that invoke sizing                                       | **c, measured**                  | Refined-peak planner passes at 2.687 s; blocking-call “static” check at 4.364 s. Historical isolated refined-peak durations are 6.95/6.44 s. 96% of blocking-call profile is planner work, not static graph traversal.                                                                                        | **Lane C:** separate long verification cases without changing fixtures or assertions. **Engine/planning owner:** reduce repeated bounded headless planning and active-work cost, with operation counts and identical plans. Keep the 480 s horizon, Capacity × transitions, verification/refinement and all fixes applied by the public-example test.                                          | **Yes** for planner/headless/engine changes under `src/sim/`.                                      |
| G3: retry outcomes, evidence, sampling and no-op comparisons                   | **c, measured representative**   | Retry-storm seed 17 passes at 3.613 s; 75.1% of its profile is inside engine ticks. Each seed currently runs five 60 s simulations (30,000 internal ticks), plus snapshots. Evidence and byte/RNG parity add more complete replays. Older failures vary across seeds/spec order.                              | **Lane C:** report each seed × simulation independently while preserving every pair, outcome band and no-op/RNG comparison; keep serial uncovered heavy placement. **Engine owner:** investigate due-work/admission/`drainLogical` costs with counts before optimizing. No assertion sampling or fewer seeds.                                                                                  | **Yes** for execution/ledger/due-work changes; no for future test partitioning outside `src/sim/`. |
| G4: tutorial completion, paused seek, control-log and health replay            | **c, measured representative**   | Backoff completion passes at 3.919 s; decoration replay at 4.214 s. Their profiles spend 26.0%/35.7% self time in `structuredClone`. Backoff plays two full 60 s runs; decoration seeks repeatedly through large retry checkpoints. Historical focused backoff and decoration runs also sometimes exceed 5 s. | **Live/controller owner with lane C:** inspect checkpoint capture cadence, retention and redundant clone/restore work; preserve paused-seek, checkpoint-boundary, continuous-health and same-seed budget assertions. Keep short controller contracts and long integration replays independently reported. **Engine owner:** optimize checkpoint graph copying only after equivalence evidence. | No for controller-only work; **yes** for engine `cloneGraph`/checkpoint changes.                   |
| G5: Git orchestration and transient admission failures                         | **c, provisional**               | Sync's conflicted-output case passes at 0.787 s. It creates real Git repositories and runs synchronous subprocesses; historical sync/gate-budget timeouts cleared in focused runs. No identical master failure is established for the sync report.                                                            | **Lane C / test infrastructure:** count and time subprocess phases in an admitted run, check filesystem/process contention and async cleanup. Reduce redundant fixture setup only after preserving the real index/rebase/staging contract. Do not bypass worker-budget locks.                                                                                                                  | No.                                                                                                |
| G6: full-run collaboration, localized dialogs, imports, exports, fit readiness | **c, provisional**               | Original 30 s full-run failures usually pass focused master/branch replays. The embed-review master repeat failed two _different_ collaboration cases. PR #189 also includes a fit-readiness assertion, not nine identical timeout signatures. No profile or controlled root-cause reproduction exists here.  | **Lane C (browser harness), collaboration/UI owners for product fixes:** capture readiness/relay/download/teardown transitions under the original concurrency; prove whether the awaited event fires. Establish a deterministic barrier before changing code. Keep fit, focus, privacy and export assertions.                                                                                  | No, unless a later profile specifically implicates engine behavior.                                |
| G7: browser clock/countdown/protocol work                                      | **c; slow-motion case resolved** | Slow-motion traces finished all 40 samples then ran out of the 30 s deadline. The existing fix reduces 160 reads to 40 and passed 279 then 750/855 wider load checks. Requests-wait spent 12.7 s advancing an 11 s fake clock; recording exhausted a 6 s `started` poll. Both later passed focused load runs. | **Lane C (browser clocks):** retain the landed slow-motion fix. Diagnose recording countdown transitions with a controlled clock; trace request playback/readiness before changing its choreography. Preserve all clock steps, captions, background freeze, active override and Undo assertions.                                                                                               | No.                                                                                                |

G2 also owns the expensive planning part of `requestsWait` and `threadFixPlan`; G4 owns their
controller replay part. Reports that merely passed in a focused rerun are not upgraded to confirmed
pre-existing product failures. The mixed simulation-heavy report's transient source-hash mismatch
cleared after edits stopped; it is not another simulation timeout cause.

## Exact sampling replay and progress evidence

The unchanged test was selected alone, retaining the repository's existing CI 40 s backstop:

```powershell
$env:CI = 'true'
$env:FC_SEED = '-53728651'
$env:FC_RUN_MULTIPLIER = '20'
fnm exec --using 24 -- node node_modules/vitest/vitest.mjs run src/sim/waits.review.test.ts --maxWorkers=1 -t 'generated scales for 1 slots' --reporter=verbose
```

Both runs reported `Test Files 1 passed (1); Tests 1 passed | 36 skipped (37)`; selection skips
the other tests, not any input in the selected property. Test durations were 19,172 ms and 20,394 ms
(complete invocations 20.68/20.73 s). Neither run reported a counterexample. The second invocation
used Node `--cpu-prof`; on Windows that captured the idle coordinator but did not flush the worker's
profile. It is **not** the engine profile used below.

For worker profiling, a temporary `src/test/timeoutTriage.heavy.test.ts` copied the one-slot helper,
generator, `propertyRuns(20)`, twenty explicit scale examples and every assertion unchanged. It
recorded `snapshot().time / 10` after the observation and drain phases, plus engine count, injection
count and `performance.now()` phase durations. It did not inject a per-tick verification callback or
alter engine scheduling. A second run used `node:inspector/promises` inside the worker:

```ts
const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.start");
// Execute the same complete property, with phase/step records.
const { profile } = await session.post("Profiler.stop");
writeFileSync(outputPath, JSON.stringify(profile));
session.disconnect();
```

The counting run passed in 30.376 s; the worker-profile run passed in 25.297 s (profile 25.283 s).
These diagnostic wall times are observations, not performance assertions. Both completed 400
property evaluations, including the explicit examples, and 800 engines, each with `inSystem === 0`.
The temporary harness, setup/config, profiles, phase records and logs are retained only in ignored
`tests/.output/timeout-triage/`; no diagnostic workload is added to ordinary CI.

| Work in the worker-profile run                | Sampled engines | Scale-1 baselines |     Total |
| --------------------------------------------- | --------------: | ----------------: | --------: |
| Engines loaded and drained                    |             400 |               400 |       800 |
| Injected dots                                 |          64,000 |           643,840 |   707,840 |
| Observation ticks                             |       2,816,800 |         2,816,800 | 5,633,600 |
| Drain ticks                                   |       2,454,400 |         2,454,400 | 4,908,800 |
| Load/inject time                              |         0.170 s |           0.796 s |   0.966 s |
| Observation time (100 pool checks per engine) |         5.402 s |          10.238 s |  15.640 s |
| Drain time                                    |         2.996 s |           5.633 s |   8.628 s |

The property draws scale `s ∈ [1,20]`, capacity 1, from `waitingFixture()`: idle source → caller,
caller → partner (Request), caller → result. Caller has one replica, 10 ms work and no jitter;
partner is overridden to 50 ms work and no jitter. Each evaluation injects `160s` real requests:
160 sampled dots versus `160s` baseline dots. It advances each engine by `100 × 70s` simulated ms,
then drains by `(volume - processed) × 100 + 1000` ms. At `s=20`, both process 2,000 requests
at 140,000 ms, then finish all 3,200 by the final 261,000 ms (26,100 ticks per engine).
All scales complete; this is not one poisonous generated model. Scale 1–20 is legal
(`resolveScale` accepts finite weights ≥1), and neither injected volume nor time exceeds the
documented bounds. No generator contract violation or missing await was found.

Read-only path: `createEngine().step` executes a counted `for` loop of 10 ms `tick()` calls;
each tick advances simulation time. CPU sampling attributes **83.6% inclusive** to `step`,
**80.8% inclusive / 33.8% self** to `tick`, **14.4% inclusive** to `admitPending`, and
**13.9% inclusive** to `drainLogical`; GC is 2.2% self. Inclusive percentages overlap and must
not be added. The baseline repeats the same small set of deterministic scale-dependent horizons
and volumes. The CPU is spent advancing/admitting/completing work, not waiting for an event.
There is therefore no failing no-progress code path or minimal liveness counterexample to report.

Historical failures remain significant: `-1353972177`, `2092662136`, `537876885`, `-715954914`
at ×20 in the earlier sweep, and `-53728651` / `-723400938` in the checkpoint sweep. The latter
report records two exact clean-master spec failures at `31aa4f4b5`, 246.62/257.10 s for the complete
spec; the one-slot test exhausted 40 s. The earlier isolated `-1353972177` master replay passed
once and failed once, while all three original two-slot serial rechecks passed. No seed is waived.

## Other targeted profiles

Temporary worker-local `beforeEach`/`afterEach` inspector hooks profiled only the selected tests,
with the normal local **5 s** backstop, one worker, no coverage and the normal unit/heavy project
configuration. The five-case run passed: `Test Files 5 passed (5); Tests 5 passed | 1979 skipped (1984)`.
The separate sync selection passed: `Test Files 1 passed (1); Tests 1 passed | 14 skipped (15)`.
After consolidation, all five `src/lib/fragments.test.ts` checks passed; the 23 preserved reports
also matched their originals after whitespace/emphasis normalization and link relocation.
No clean-master full suite, new browser run, full gate or parity sweep was run for this docs-only
diagnosis, per the targeted-only brief. Existing historical failures below are not passing checks.

| Selected case                                                                                                    | Vitest duration | Worker profile finding                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | --------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scalingPlanner.heavy`: keeps each refined peak with the Capacity × it was wanted under                          |        2,687 ms | `advanceHeadless` 94.4% inclusive; `engine.step` 78.5%; `tick` 31.8% self. Planner bounds cap runs at four and the horizon at 600 s; this fixture uses 480 s.                   |
| `checks/examples.heavy`: checks on the public examples > blocking-call                                           |        4,364 ms | `planScaling` 96.4% inclusive, `advanceHeadless` 95.9%. `runChecks` and subsequent fixed-diagram checks invoke verified sizing.                                                 |
| `retry-storm.heavy`: retry storm outcome bands at seed 17                                                        |        3,613 ms | `engine.tick` 75.1% inclusive, `drainLogical` 30.9%. Five full 60 s outcomes are compared.                                                                                      |
| `completionSweep`: backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers  |        3,919 ms | Test `play` 92.2% inclusive; `engine.tick` 53.1%; `captureCheckpoint` 26.7%; `structuredClone` 26.0% self. The two 60 s playbacks retain their seed and backlog/goodput checks. |
| `decorations`: preserves continuous queue attention on paused seeks and checkpoint restores: three-quick-retries |        4,214 ms | `seek` 83.1% inclusive; `engine.tick` 47.2%; `cloneGraph` 36.2%; `structuredClone` 35.7% self. All seek/restore/health assertions completed.                                    |
| `sync`: reloads upstream policy after checkout (conflicted output: true) and ends clean                          |          787 ms | Real subprocess/index fixture completes; historical full-run timeout remains unconfirmed in isolation.                                                                          |

These are representative profiles, not measurements of every historical failing case. In particular,
the high-rate breaker, no-op, control-log, collaboration and recording families still need their own
controlled profiles before an implementation change. A timeout alone does not prove a hang.

## Rejected changes and follow-up acceptance

No timeout increases, retries, seed exclusions, quarantines, shorter simulation horizons, fewer
observations, relaxed throughput bands or re-recorded goldens. Moving a file to heavy alone cannot
fix its single-test CPU cost; these tests already include serial uncovered cases. A broad engine
optimization here would conflict with lane B's pure moves, so **every `src/sim/` implementation
proposal waits for engine split PR 5**. No test-side defect with mutation-checked evidence was found,
so this PR contains documentation consolidation only; fix-reversion checking is not applicable.

For a later fix, retain the exact seed/multiplier stream, fixed examples and semantic assertions;
demonstrate the removed work with counts or same-run baselines and a deliberate regression. Verify
unchanged output parity for any production refactor. Browser fixes must reproduce the actual
readiness/clock transition under load, rather than spend a larger deadline waiting for it.

## Original reports and provenance

The following reports retain their complete original facts, commands, clean-master SHAs, SUMMARY
lines and uncertainty. They describe historical repository layouts and verification policy; follow
the current task/rules for new work. Immutable source links also preserve the original text.

| Report             | Superseded fragment                                     | Group         |
| ------------------ | ------------------------------------------------------- | ------------- |
| [01](#evidence-01) | 2026-10-18-collaboration-load-timeouts-embed-review.md  | G6            |
| [02](#evidence-02) | 2026-10-18-slowmo-load-timeout.md                       | G7 (resolved) |
| [03](#evidence-03) | 2026-10-19-engine-ledger-gate-timeouts.md               | G7            |
| [04](#evidence-04) | 2026-10-19-pr189-full-gate-workload-timeouts.md         | G6            |
| [05](#evidence-05) | 2026-10-19-requests-wait-collaboration-timeouts.md      | G6            |
| [06](#evidence-06) | 2026-10-23-example-check-hang-backstops.md              | G2, G3        |
| [07](#evidence-07) | 2026-10-23-local-unit-timeouts-under-load.md            | G2, G3, G4    |
| [08](#evidence-08) | 2026-10-24-heavy-simulation-timeouts.md                 | G2, G3, G5    |
| [09](#evidence-09) | 2026-10-24-native-replay-timeouts.md                    | G2, G4        |
| [10](#evidence-10) | 2026-10-24-native-suite-load-timeouts.md                | G2, G4, G5    |
| [11](#evidence-11) | 2026-10-24-waits-review-sweep-timeout.md                | G1            |
| [12](#evidence-12) | 2026-10-25-backoff-budget-completion-timeout.md         | G4            |
| [13](#evidence-13) | 2026-10-25-backoff-budget-sweep-timeout.md              | G4            |
| [14](#evidence-14) | 2026-10-25-backoff-sweep-timeout.md                     | G4            |
| [15](#evidence-15) | 2026-10-25-decorations-replay-timeout.md                | G4            |
| [16](#evidence-16) | 2026-10-25-sampling-sweep-hang-backstop.md              | G1            |
| [17](#evidence-17) | 2026-10-25-simulation-heavy-timeouts.md                 | G2, G3, G4    |
| [18](#evidence-18) | 2026-10-25-tutorial-backoff-budget-timeout.md           | G4            |
| [19](#evidence-19) | 2026-10-25-tutorial-backoff-fix-round-verification.md   | G4            |
| [20](#evidence-20) | 2026-10-25-tutorial-backoff-sweep-timeout.md            | G4            |
| [21](#evidence-21) | 2026-10-25-tutorials-backoff-timeout.md                 | G4            |
| [22](#evidence-22) | 2026-10-25-tutorials-quarantine-backoff-verification.md | G4            |
| [23](#evidence-23) | 2026-10-25-tutorials-track-fix-backoff-verification.md  | G4            |

### Evidence 01

<details>
<summary>2026-10-18-collaboration-load-timeouts-embed-review.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-18-collaboration-load-timeouts-embed-review.md).

## Collaboration timeouts under parallel browser load

Confluence embed review verification ran the full Linux gate at 12 workers and 12 CPUs on
`58163ca4c6851bbc14b1d807951696f4c2d5dff4`. All static checks, unit coverage, builds, entry size and
2,525 parity goldens passed. Browser results were 1,717 passed and two whole-test 30-second timeouts:

- `tests/e2e/collab-c1a.spec.ts`: pasting Private content stops sharing before the paste reaches peers or room recovery.
- `tests/e2e/collab-room.spec.ts`: a copy that can't be saved holds the room's canvas behind a dialog: file copy, Try again.

```text
SUMMARY: 58163ca4c6851bbc14b1d807951696f4c2d5dff4 | unit={"passed":11344,"failed":0,"skipped":4} parity={"goldens":2525,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1717,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

The single clean-master comparison checked out `origin/master` at
`d1b2627fffddff4b579155fc724362ed2a6317db` in the same worktree, with no changes, and ran only those
two spec files twice with the same Linux worker/CPU settings:

```sh
pnpm gate quick tests/e2e/collab-c1a.spec.ts tests/e2e/collab-room.spec.ts --linux --repeat 2 --workers 12 --cpus 12 --only e2e --max-wait 1
```

Repeat one passed all 44 tests. Repeat two passed 42 and timed out two **different**
`collab-room.spec.ts` cases: “Leave keeps your copy in Your diagrams, and Don't join leaves nothing
behind” and “a peer deleting the right-clicked node closes the menu (remote), the canvas takes the
keyboard, the view stays”. Both original failing cases passed both clean-master repetitions;
identical reproduction of those original failures is therefore **not established**.

```text
SUMMARY: d1b2627fffddff4b579155fc724362ed2a6317db | unit="not run" parity="not run" e2e={"passed":86,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

Follow up on collaboration timing under parallel load, including copy/download completion and
test teardown. Preserve assertions and establish the cause before changing any backstop. No
collaboration code, assertions or timeouts were changed for the embed fixes. The embed and UI
neighbour load gate passed all 540 tests across five Linux repetitions, and every output golden
remained unchanged. Further full-suite or clean-master runs were deferred to CI under the
verification budget.

</details>

### Evidence 02

<details>
<summary>2026-10-18-slowmo-load-timeout.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-18-slowmo-load-timeout.md).

## Slow-motion test exhausts its whole-test deadline under load

`tests/e2e/slowmo.spec.ts:135`, "from a node: the background freezes, at most 4
dots move, captions tell each hop", intermittently reaches Playwright's existing
30-second whole-test timeout in the Linux load run. The native focused gate
passes all 69 tests.

The same case and whole-test timeout reproduce on a clean `origin/master`
checkout at `ee61494c7c3f43326aedd928f09e37bcf5adf122`, exported into an ignored
scratch checkout inside the working repository. Both first repetitions report
68 passed and 1 failed. The checkout stays clean; no test or application changes
are applied there.

Both traces complete the 40-step background-freeze and caption loop. The branch
trace expires at the final `live-more` click; the clean-master trace expires at
the preceding first `trace-hop-seek-` click. These are whole-test deadline
failures, rather than failed freeze, dot-count or caption assertions.

Run from either checkout with the same configuration:

```sh
pnpm gate quick tests/e2e/live.spec.ts tests/e2e/slowmo.spec.ts tests/e2e/present.spec.ts tests/e2e/trace.spec.ts --linux --only e2e --repeat 3 --workers 8 --cpus 4 --memory 12g --ports 6840 --max-wait 1
```

Investigate the loop's browser protocol round trips and final fake-clock
interactions while retaining every assertion. Do not enlarge the timeout or
weaken the camera, freeze, particle or caption checks to hide the failure. This
interface-only refactor leaves the existing test and production behavior intact.

Branch code: one timeout in the first repetition; the other two repetitions pass
all 69 cases.

```text
SUMMARY: d5347142b59d4aba15dd430c303a4788cb417d53 | unit="not run" parity="not run" e2e={"passed":206,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Clean `origin/master`: the same case reaches the same whole-test timeout in all
three repetitions, with every other case passing.

```text
SUMMARY: ee61494c7c3f43326aedd928f09e37bcf5adf122 | unit="not run" parity="not run" e2e={"passed":204,"failed":3,"flaky":0,"skipped":0} gate_failures=3
```

## Resolved in follow-ups seven

The release note `docs/release-notes/2026-10-18-followups-seven.md` records the fix and regression
coverage. The original clean-master reproduction above is retained as evidence; no threshold or
assertion was relaxed.

</details>

### Evidence 03

<details>
<summary>2026-10-19-engine-ledger-gate-timeouts.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-19-engine-ledger-gate-timeouts.md).

## Unclassified full-gate UI timing failures

The R1 review-fix full Linux gate ran on
`d0c42792ad82e4c8314c2512f2fab31c8d64a86a`, before master advanced, with six
workers, six CPUs, ports 6750–6754 and zero retries. It passed static checks,
12,254 unit tests, build/size and all 2,712 unchanged output goldens, then failed
two Chromium cases among 1,798 E2E cases:

- `record.spec.ts`: `failEncoder: failure stops capture and permits retry`
  exhausted its six-second poll for the fake recorder's `started` flag.
- `requests-wait.spec.ts`: `the trouble fix updates the active waiting override
and undo restores playback` exhausted the whole-test 30-second backstop. Its
  trace includes 12.7 seconds in the 11-second fake-clock playback, followed by
  the expected fix/undo interactions; it timed out before completing playback.

Exact full-gate summary:

```text
SUMMARY: d0c42792ad82e4c8314c2512f2fab31c8d64a86a | unit={"passed":12254,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1796,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

## Targeted checks and remaining work

The only clean-master comparison was both affected spec files, repeated twice
with six workers and six CPUs in Linux. All 58 cases passed on
`86529d14e6e9f44d7492b4bdfcd6508f1c35e4e4`. That master has the same simulation
engine as the original trace baseline, `354b5dd0`. These results do **not** prove
the full-gate failures pre-exist on master.

After syncing the branch, both files passed five Linux load repetitions on
`a85d80788689232637d7c3c6217ed55793ae00a3`: 145 passed, zero failed or flaky,
again with six workers and six CPUs. The rebased engine also passed 163 focused
tests, including its properties, and all 2,606 node goldens were unchanged.

Investigate deterministic recording countdown control and the wall-clock cost
of the request test's scripted playback under full-suite load. Preserve the
start, retry, active override and undo assertions; do not label the failures as
confirmed pre-existing or waive the failed full gate based on isolated passes.
The requested verification-budget/full-gate precedence decision remains pending.
No production UI code, affected UI tests or output goldens were changed for these
failures. Reports remain in `tests/.output/g/rG3nPop`, `r2p0adg` and `rEfRAa5`.

</details>

### Evidence 04

<details>
<summary>2026-10-19-pr189-full-gate-workload-timeouts.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-19-pr189-full-gate-workload-timeouts.md).

## PR #189 full-gate workload failures

The final executable change is `3fc05404bc0710d25caa893dcf5907d60a8e306e`. Its Linux archive gate used
12 workers and 12 CPUs, with zero retries. Static checks, unit coverage, production build, entry/viewer size
and every output golden passed. The all-project browser invocation completed all 1,773 checks with nine failures:

```text
SUMMARY: 3fc05404bc0710d25caa893dcf5907d60a8e306e | unit={"passed":11761,"failed":0,"skipped":4} parity={"goldens":2672,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1764,"failed":9,"flaky":0,"skipped":0} gate_failures=1
```

Failures were whole-test timeouts in the language/revert reload flow; German share/password/unlock dialogs;
German and Arabic embed/library dialogs; large-import boundary selection; the P1 live Inspector flow;
cancellable image export; and embedded latency-detail scrolling. The ninth failure was the overlap audit's
fit-readiness assertion while a tooltip was open. These test files are unchanged from origin/master.

Only the eight failed case locations were then selected (the localized cases expand to 13 checks), twice,
on clean origin/master `093e2057231fd7de3293335d34ba75bf1fa775db`. The gate runner's subset API retained
the same Linux archive transport, production profiles, 12 workers and 12 CPUs; no full master suite was run:

```text
SUMMARY: 093e2057231fd7de3293335d34ba75bf1fa775db | unit="not run" parity="not run" e2e={"passed":26,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The identical focused comparison on the branch also passed:

```text
SUMMARY: 3fc05404bc0710d25caa893dcf5907d60a8e306e | unit="not run" parity="not run" e2e={"passed":26,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

These nine failures were observed only in the complete invocation; their cause is unconfirmed, and they are
not classified as reproduced clean-master failures. Reproduce the full-suite concurrency or preceding workload
before changing their implementation. Keep the existing assertions, fit-readiness waits and timeouts.
The separate [annotation keyboard race](2026-10-18-annotation-keyboard-load-races.md) did reproduce on clean master.

The simulation regressions, including temporary reversions, passed after restoration. The final focused engine
and controller run passed 387 tests; five Linux load repetitions of the affected browser specs passed 135 checks
with zero failures or flaky results. No simulation golden changed; only catalog metadata for the recovery notice
was intentionally updated. The commit after the executable change records this verification evidence only.

</details>

### Evidence 05

<details>
<summary>2026-10-19-requests-wait-collaboration-timeouts.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-19-requests-wait-collaboration-timeouts.md).

## Collaboration timeouts in the full Linux gate

The requests-wait review fixes at `0e6a62287e7d00277392fc15778c1436d34df1ce` passed all static
checks, unit coverage, builds, entry size and output parity. The one full Linux gate used 12 workers
and 12 CPUs. Five Chromium cases reached the existing 30-second whole-test backstop:

- `collab-c1a.spec.ts:213`: isolated editors preserve a pending inspector edit, scope Undo/Redo, and handle remote deletion.
- `collab-c1a.spec.ts:638`: remote stencil changes restore focus when the focused inspector control disappears.
- `collab-c1a.spec.ts:722`: pasting Private content stops sharing before the paste reaches peers or room recovery.
- `collab-c1a.spec.ts:950`: a peer edit between image export slices aborts with a retry toast and preserves scoped Undo.
- `collab-room.spec.ts:602`: Share's Edit together, after Link with password and never first, starts a room from the open diagram.

```text
SUMMARY: 0e6a62287e7d00277392fc15778c1436d34df1ce | unit={"passed":11915,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1780,"failed":5,"flaky":0,"skipped":0} gate_failures=1
```

## Focused comparison

A clean local clone of `origin/master` at `c3d15a42c3c0f455769ea8817442580b37b3e028`, inside
this checkout's ignored test-output directory, ran only the two affected specs once with two repetitions:

```sh
pnpm gate quick tests/e2e/collab-c1a.spec.ts tests/e2e/collab-room.spec.ts --linux --only e2e --repeat 2 --workers 12 --cpus 12 --max-wait 1
```

Both repetitions passed all 45 cases. The feature branch then ran the identical focused command;
both repetitions passed there too. These quick comparisons use the gate's bind source mode; the
full run uses its archived-HEAD mode. Identical reproduction on clean master is **not established**.

```text
SUMMARY: c3d15a42c3c0f455769ea8817442580b37b3e028 | unit="not run" parity="not run" e2e={"passed":90,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 0e6a62287e7d00277392fc15778c1436d34df1ce | unit="not run" parity="not run" e2e={"passed":90,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Follow-up

Investigate full-suite interference, resource pressure and teardown around these collaboration cases.
Preserve assertions and establish the cause before changing any backstop. No collaboration code,
assertions or timeouts were changed for the waiting fixes. The affected waiting/UI-neighbour sweep
passed all 930 cases across five Linux repetitions, and all six P1 regressions fail against c45bcba9.
Further full-suite or clean-master runs are deferred to PR CI under the verification-budget instruction.

Related earlier evidence: [collaboration load timeouts during embed review](#evidence-01).

</details>

### Evidence 06

<details>
<summary>2026-10-23-example-check-hang-backstops.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-23-example-check-hang-backstops.md).

## Native public-example checks can exhaust their hang backstop

The review-loop follow-up's native `pnpm test --maxWorkers=1` run timed out in
`src/checks/examples.test.ts`: the `blocking-call` static check, and the `retry-storm` and
`blocking-call` simulation-evidence cases. These hit the existing five-second test hang backstop;
this PR changes no example, simulation or checks implementation.

The same test file was run twice on a clean detached checkout of origin/master at
`2c6a463cb0f79dfd44c025c06aad486120ddacc9`, inside this workspace, using the same frozen dependencies.
The first repetition reproduced the `blocking-call` static-check and `retry-storm` evidence
timeouts: 2 failed, 102 passed (including type checks). The second passed all 104 checks. The
`blocking-call` evidence timeout did not recur in those two isolated repetitions. This records the
observed variation rather than claiming every native timeout reproduced individually.

Reproduce with `pnpm test src/checks/examples.test.ts --maxWorkers=1` under native host load.
Owner: Live Diagrams maintainers. Follow up by splitting or bounding the heavy example workloads
while preserving their semantic assertions; do not weaken an assertion or re-record output goldens.
No full clean-master suite was run.

</details>

### Evidence 07

<details>
<summary>2026-10-23-local-unit-timeouts-under-load.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-23-local-unit-timeouts-under-load.md).

## Local unit timeouts under shared-machine load

During #265 verification, `pnpm test --maxWorkers=2` reported eleven failures at the configured local five-second test timeout across `scalingPlanner.test.ts`, `examples.test.ts`, `controlLog.test.ts` and `breaker.sampling.test.ts`. The broad run was stopped after those reports to respect the verification budget; it did not produce a complete suite summary. No assertions or timeouts were changed.

Each affected file was replayed twice on a clean `git archive` of `origin/master` at `2c6a463cb0f79dfd44c025c06aad486120ddacc9`, inside this worktree's ignored output directory with the same installed dependencies, local timeout and two declared workers. These are targeted Vitest results, including its typecheck project, not full-gate results:

| Master spec                        | First replay        | Second replay        |
| ---------------------------------- | ------------------- | -------------------- |
| `src/sim/scalingPlanner.test.ts`   | 5 failed, 37 passed | 4 failed, 38 passed  |
| `src/sim/examples.test.ts`         | 132 passed          | 1 failed, 131 passed |
| `src/live/controlLog.test.ts`      | 3 failed, 41 passed | 44 passed            |
| `src/sim/breaker.sampling.test.ts` | 4 failed, 9 passed  | 2 failed, 11 passed  |

Every master failure reports `Test timed out in 5000ms`; type checks report no errors. The refined-peak planner case, the blocking-call example, fault-overlay replay and high-rate breaker cases reproduce failures from the branch run. The files are unchanged from master. Counts vary with contention, so these are local load-sensitive failures, not a claim that all tests fail deterministically. Local evidence is retained in `tests/.output/inspector-master-{scaling,examples,control-log,breaker}-{1,2}.log` and the interrupted branch run in `tests/.output/inspector-unit.log`.

Follow up by profiling the long simulation cases in the admitted gate environment and reducing redundant fixture work where possible. Keep their behavioral assertions and the existing CI configuration; do not increase the local timeout to conceal contention. The requested Linux Inspector gate could not acquire capacity on either attempt (exit 75); another live gate held the complete 12-worker budget. No gate summary was produced for those attempts.

</details>

### Evidence 08

<details>
<summary>2026-10-24-heavy-simulation-timeouts.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-24-heavy-simulation-timeouts.md).

## Heavy simulation tests exceed the Windows hang backstop

While verifying keyboard/touch line shaping on Node 24.22.0, the unrelated `scalingPlanner.heavy.test.ts` case "keeps each refined peak with the Capacity × it was wanted under" exceeded Vitest's 5 s whole-test timeout. The same case fails on an unchanged archive of origin/master `069291556bb345348d306ef171a4fcde7a4d8e81`, using the frozen lockfile and one Vitest worker: both targeted repetitions failed (6.95 s and 6.44 s measured test durations). Each repetition had 62 passing tests and this single failure across the three targeted files; `gateBudget.test.ts` and `sync.test.ts` passed both times.

The original whole-suite run also reported transient gate-budget and sync failures; their targeted branch rerun passed all 42 tests. Keep simulation performance work separate from line editing. Investigate the long planner fixture and its execution cost without loosening assertions or adding a timing budget.

The heavy retries no-op case for the busy-threads corpus fixture also exceeded the same hang backstop. A separate targeted clean-master two-repetition run reproduced it once (5.18 s, 11 passing tests), then passed all 12 tests. No simulation implementation or assertions were changed in the keyboard/touch branch.

</details>

### Evidence 09

<details>
<summary>2026-10-24-native-replay-timeouts.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-24-native-replay-timeouts.md).

## Native replay hang backstops under concurrent load (2026-10-24)

The resilience-checks branch's native `pnpm test --maxWorkers=2` overlapped the required eight-worker
engine sweep. Several existing replay tests crossed the local five-second hang backstop. No assertion
was weakened or timeout changed. Focused checks using the repository's existing `CI=true` configuration
pass, including 148 tests across the affected waiting/health/check suites and the three selected sampling
cases. The broad native run is not a passing verification claim.

A clean archive of origin/master `8e58be7e421cd6b812d85ec0182a13244d59e8de`, inside this checkout's
ignored test output, ran only five suspected files twice with one worker under the same load. It
reproduced the exact five-second timeout in:

- `src/live/decorations.test.ts`: paused seeks/checkpoint restores, three-quick-retries (both attempts).
- `src/checks/requestsWait.test.ts`: public CPU example's identical primary edits (first attempt).
- `src/live/threadFixPlan.test.ts`: verified busy-thread policy before call-semantics changes (first attempt).

Master's first targeted attempt: **3 failed, 46 passed** across five files. Second: **1 failed, 48 passed**.
The selected run-end lesson and call-failure-rate files passed on master both times; they must not be
labelled proven master failures. The branch's focused CI-mode rerun passed those files too.

Follow up on the placement/workload of these replay tests and on running local verification with the
repository's intended CI hang backstops while reserving enough shared workers. Preserve behavioural
assertions and zero-retry CI; no broader clean-master suite was run.

</details>

### Evidence 10

<details>
<summary>2026-10-24-native-suite-load-timeouts.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-24-native-suite-load-timeouts.md).

## Native full-suite timeouts under host load

During shaped-line interop verification on Windows/Node 24.22.0, the full native unit run hit test
backstops in `src/lib/sync.test.ts` (reloads upstream policy, conflicted output true),
`src/checks/requestsWait.test.ts` (public CPU example primary edits), and
`src/live/threadFixPlan.test.ts` (verified busy-thread policy). No assertions or timeouts were changed.

Focused checks of all three specs on an untouched origin/master snapshot at
`069291556bb345348d306ef171a4fcde7a4d8e81` passed twice: sync/requestsWait 26 tests each run,
and threadFixPlan 8 tests each run. The branch's focused run then passed all 34 tests. These probes
do not reproduce the full-run timeouts, so this is not a claim of a proven master failure. Investigate
scheduling/host-load sensitivity if it recurs in CI; keep substantive assertions intact.

</details>

### Evidence 11

<details>
<summary>2026-10-24-waits-review-sweep-timeout.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-24-waits-review-sweep-timeout.md).

## Existing pool-property backstop at multiplier 20 (2026-10-24)

The resilience PR 4 engine merge sweep ran on Node 24.22.0 with `CI=true`, 40 fresh seeds at ×5
and four at ×20, eight budgeted jobs. Its exact result was:

`SUMMARY: 40 passed, 4 failed, 0 unrun; 1854.91s`

There were no counterexamples. All four ×20 runs passed the resilience-invariant file and the other
engine files except `src/sim/waits.review.test.ts`. They crossed its existing 40-second CI hang
backstop in `sampled callers preserve non-divisible pool capacity: generated scales for 1 slots`;
three also crossed it for two slots. Failed seeds: `-1353972177`, `2092662136`, `537876885`,
`-715954914`. No timeout, assertion or property run count was changed.

The exact one-slot case at seed `-1353972177`, `FC_RUN_MULTIPLIER=20`, was then run twice on a
clean archive of origin/master `8e58be7e421cd6b812d85ec0182a13244d59e8de`: one passed and one
reproduced the identical 40-second timeout (52.54 s total). The later tutorial master `f88b5443`
does not change the simulator/model/stencil sources, and rebasing preserved the feature's engine
sources byte for byte. This is an existing load-sensitive backstop, not an invariant counterexample.

For precision, two earlier isolated master attempts at seed `2092662136` passed both one- and
two-slot cases; they are not evidence of a master failure. A serial branch recheck at the actual
failing seed `-1353972177` still crossed the one-slot backstop. The three two-slot cases, checked
serially with their original seeds and ×20 counts, all passed:

`SUMMARY (two-slot x20 recheck): 3 passed, 0 failed, 0 unrun`

Follow up on the repeated baseline simulation work and the placement of this expensive property.
Preserve generated coverage, fixed scale examples, sampling assertions and zero-retry CI; do not
loosen the backstop to hide a counterexample. PR CI on the feature passed all checks before the
upstream tutorial rebase; the rebased branch receives fresh CI.

</details>

### Evidence 12

<details>
<summary>2026-10-25-backoff-budget-completion-timeout.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-backoff-budget-completion-timeout.md).

## Backoff-budget completion sweep timeout on clean master

The targeted integration run for PR #335 passed 2,778 tests and skipped 101, but `src/tutorials/completionSweep.test.ts` → `backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers` exceeded its existing 5,000 ms hang backstop. A focused branch rerun failed identically.

A clean archive of `origin/master` at `e98a679e5db42a38d5f3fea5db319c136dd5c08d`, extracted under this checkout's ignored test output, reproduced the same timeout in both focused runs (one worker, unchanged source and timeout). Each summary was `Test Files 1 failed (1); Tests 1 failed | 1733 skipped (1734)`. No full suite was run on master.

Investigate this simulation-heavy completion regression independently. Do not change its timeout or quarantine it as part of the arrangement compatibility fix.

</details>

### Evidence 13

<details>
<summary>2026-10-25-backoff-budget-sweep-timeout.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-backoff-budget-sweep-timeout.md).

## Backoff-budget completion sweep timeout

The tutorial unit run for PR #347 round 1 reported 2,283 passed, 119 skipped and one failure:
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`
exceeded Vitest's existing 5,000 ms test timeout. The isolated test also timed out on this branch.

The same isolated test was run twice against a clean archive of origin/master at `762534298`
inside this worktree, using the installed dependencies and two workers. Both runs reproduced
`Error: Test timed out in 5000ms.` Each summary was `Test Files 1 failed (1)` and
`Tests 1 failed | 1681 skipped (1682)`. No full suite was run on master.

Investigate the seeded workload and completion path without weakening its assertions or adding
an elapsed-time performance budget. The fan-out/RAG regressions pass independently.

## Re-quarantine verification - PR #347

The targeted `pnpm test src/tutorials --maxWorkers=2` run after restoring Fan-out and RAG quarantine
reported 2,238 passed, 164 skipped and this same single timeout. Cells' negative coverage remains
active and passes. The clean-master reproduction above already establishes the timeout as pre-existing;
this quarantine round does not change its assertions, workload or timeout.

## Load-dependent sweep timeouts - PR #346 repair API pass

A full `src/tutorials src/live src/editor` run on a busy shared machine timed out four `src/live` cases and,
in another run, `backoff-budget: jitter…`, `retry-storm: reading the caller…`, `no-threads-waiting (b)` and
`pool-40 (c)`. Every one passed when rerun alone. None was changed by this PR.

</details>

### Evidence 14

<details>
<summary>2026-10-25-backoff-sweep-timeout.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-backoff-sweep-timeout.md).

## Backoff completion sweep timeout on Windows

On 2026-10-25, the Checkout reference fix ran `pnpm test src/tutorials --maxWorkers=2`:
`Tests 1 failed | 2601 passed (2602)`. The only failure was
`completion regressions > backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`,
which exceeded Vitest's existing 5000 ms hang backstop. The isolated test passed unchanged.

The completion-sweep spec was then run twice on clean `origin/master`
(`5f1dee035af65f8f5d3d583fc6d7007f68436be0`) in the same Windows worktree, Node 24.22.0, using
`pnpm exec vitest run src/tutorials/completionSweep.test.ts --maxWorkers=1`.
The first run reproduced only that same timeout:
`Tests 1 failed | 1775 passed | 38 skipped (1814)`.
The second run passed unchanged:
`Tests 1776 passed | 38 skipped (1814)`.
This establishes a pre-existing intermittent failure rather than a deterministic regression.

Follow up on the long synchronous simulation playback in that regression. Preserve its seeded backlog and goodput
assertions; do not relax them or raise the timeout. Checkout's entire completion contract and all 171 tutorial
production-build browser tests pass. No output goldens changed.

</details>

### Evidence 15

<details>
<summary>2026-10-25-decorations-replay-timeout.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-decorations-replay-timeout.md).

## Existing queue-decoration replay timeout under load

The engine-split PR's ordinary `pnpm test --maxWorkers 2` run timed out in
`src/live/decorations.test.ts`, test
`preserves continuous queue attention on paused seeks and checkpoint restores: three-quick-retries`.

Ran only that test twice on a clean checkout of `origin/master` at
`a2506160a5177ec55ab46a5a44b937ac9d695303`, inside this workspace's ignored test output directory, using the
same Node 24.22.0 and dependencies. Both runs failed with the identical `Test timed out in 5000ms` error;
each selected one test and skipped the other ten. No clean-master full suite was run.

Keep the test's behavioral assertions unchanged. Investigate its replay workload and whole-test hang backstop
under contention independently of the pure engine extraction.

</details>

### Evidence 16

<details>
<summary>2026-10-25-sampling-sweep-hang-backstop.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/91185272b092e1cdfe0d8b6c4b271cc72abd65d4/docs/backlog/2026-10-25-sampling-sweep-hang-backstop.md).

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

</details>

### Evidence 17

<details>
<summary>2026-10-25-simulation-heavy-timeouts.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-simulation-heavy-timeouts.md).

## Existing simulation-heavy timeout backstops under contention

During the engine split's ordinary unit/heavy run, these unchanged specs hit Vitest's existing 5-second whole-test
backstop. No behavior assertion or timeout was loosened. A clean checkout of `origin/master` at
`a2506160a5177ec55ab46a5a44b937ac9d695303`, within this workspace's ignored test output, reproduced the failures
with the same Node 24.22.0 and dependencies:

| Spec and cases                                                                                                                                                                    | Clean-master run 1      | Clean-master run 2      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------- |
| `src/sim/scalingPlanner.heavy.test.ts`: capacity-in-force decisions; refined peak's Capacity ×                                                                                    | 1 timed out, 20 passed  | 2 timed out, 19 passed  |
| `src/checks/examples.heavy.test.ts` and `src/examples/retry-storm.heavy.test.ts`, with only the other failed specs (`retries.noop`, `threadFixPlan`, `reviewLoop`) alongside them | 6 timed out, 146 passed | 5 timed out, 147 passed |

Both planner cases reproduced; the refined-peak case failed in both whole-spec runs. Selecting just those two
cases had passed twice, so whole-spec order/load matters. Both remaining-spec runs reproduced checks on
`blocking-call`, simulation evidence on `retry-storm` and `blocking-call`, and retry-storm outcome bands at seeds
7 and 42; seed 17 also timed out in the first run. Other original timeouts cleared in targeted reruns.

These were targeted spec runs, not clean-master full suites. Keep the seeded outcomes and behavior assertions;
investigate workload cost, isolation and whole-test hang backstops under load separately from the pure move.

On the stable extraction, rerunning only the seven affected specs produced 170 passes and five identical
timeouts: the blocking-call check, retry-storm evidence, retry-storm seed 17, and both planner cases. Every one
of those five reproduced above on clean master. `reviewLoop`, `threadFixPlan`, `retries.noop` and the stable
engine-version test passed. The initial broad run had 13,210 passes, 15 failures, 10 expected failures and 156
skips; its in-flight source-hash mismatch cleared once source edits stopped. The tutorial and decoration
timeouts have separate evidence fragments.

</details>

### Evidence 18

<details>
<summary>2026-10-25-tutorial-backoff-budget-timeout.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-tutorial-backoff-budget-timeout.md).

## Existing backoff-budget tutorial timeout under load

The engine-split PR's ordinary `pnpm test --maxWorkers 2` run timed out in
`src/tutorials/completionSweep.test.ts`, test
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`.

Reproduced only that test twice on a clean checkout of `origin/master` at
`a2506160a5177ec55ab46a5a44b937ac9d695303`, inside this workspace's ignored test output directory, using the
same Node 24.22.0 and dependencies. The first run failed with the identical `Test timed out in 5000ms` error;
the second passed. Each run selected one test and skipped the other 1,733. No clean-master full suite was run.

The extraction's focused replay, lineage, latency and partial-dot tests passed, and its moved-body comparison
preserves the tick and simulation expressions. Keep this tutorial flake separate from the pure engine move;
investigate its work and whole-test hang backstop under contention without weakening behavior assertions.

</details>

### Evidence 19

<details>
<summary>2026-10-25-tutorial-backoff-fix-round-verification.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-tutorial-backoff-fix-round-verification.md).

## PR #339 backoff timeout verification

Additional evidence for [the existing backoff sweep timeout](#evidence-20):
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers` in
`src/tutorials/completionSweep.test.ts` exceeded its 5,000 ms hang backstop during PR #339 fix-round verification.
Its assertions and timeout were left unchanged. The final tutorial unit run reported **1 failed, 2,253 passed,
119 skipped**; this was its only failure.

A clean tracked-file snapshot of `origin/master` at `45e79585d16987f198ea4bf43461fd549d149e16`, extracted inside
this worktree's ignored test output directory and using the installed dependencies, reproduced the same timeout.
Only that case ran twice with one worker: the first run reported **1 failed, 1,586 skipped** (5,134 ms timeout);
the second reported **1 passed, 1,586 skipped**. Investigate its simulation workload and scheduling without
loosening its checks.

</details>

### Evidence 20

<details>
<summary>2026-10-25-tutorial-backoff-sweep-timeout.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-tutorial-backoff-sweep-timeout.md).

## Backoff-budget completion sweep timeout

The completion regression `backoff-budget: jitter fails the backlog expectation but the same seeded
budget run recovers` exceeds the existing five-second test timeout when run in the completion sweep.
The focused test passes, but the full tutorial unit run reports 2,061 passed, 63 skipped and this one timeout.

Confirmed on clean `origin/master` at `489125be` in this same worktree with two runs of
`pnpm exec vitest run src/tutorials/completionSweep.test.ts --maxWorkers=1`. Both runs report
`Test Files 1 failed (1)` and `Tests 1 failed | 1380 passed | 147 skipped (1528)`, with the same timeout
in the same regression. This predates PR #337's observation and consumer-binding fixes.

Investigate the seeded run's cost in the sweep without weakening its assertions or increasing its timeout.

</details>

### Evidence 21

<details>
<summary>2026-10-25-tutorials-backoff-timeout.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-tutorials-backoff-timeout.md).

## Existing backoff-budget completion regression timeout

The build-11 tutorial run passes 2,106 tests and skips 147 quarantined cases, but
`completionSweep.test.ts` → `backoff-budget: jitter fails the backlog expectation but the same seeded budget run
recovers` exceeds Vitest's existing 5-second test timeout.

The same isolated test times out twice on clean source archived from `origin/master`
(`489125be16616b3294fbb9ceaa4d5096c4e95370`) inside this worktree's ignored test-output directory. Both probes use
Node 24.22.0, the same frozen dependencies and one Vitest worker. Each reports **1 failed, 1,527 skipped**;
durations are 11.47 s and 6.75 s including transform/import work. The test itself hits the same 5-second timeout
in both probes. No timeout or assertion was relaxed.

Investigate the test's seeded backoff workload and its synchronous simulation work in the resilience lane.
The three new design studies' completion and evidence cases pass independently.

</details>

### Evidence 22

<details>
<summary>2026-10-25-tutorials-quarantine-backoff-verification.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-tutorials-quarantine-backoff-verification.md).

## PR #339 quarantine-round backoff timeout evidence

The targeted `src/tutorials` run reported **1 failed, 2,212 passed, 161 skipped**. Its only failure was
the existing `backoff-budget: jitter fails the backlog expectation but the same seeded budget run
recovers` completion regression exceeding its unchanged 5,000 ms hang backstop. The separate Cells
sweep selection passed all 26 cases. No runner, timeout or assertion was changed.

The backoff case passed when run alone on this branch with one worker. Two isolated runs on a clean
tracked-file snapshot of `origin/master` at `b72a88ccb8e6774d3a446400a8f309245f954277`, extracted
inside this worktree's ignored test output directory and using its installed dependencies, also
passed (**1 passed, 1,586 skipped** each). This round therefore did not reproduce the timeout on
current master; earlier clean-master timeout evidence remains in
[the previous verification fragment](#evidence-19) and
[the original timeout entry](#evidence-21).

Investigate the existing simulation workload and scheduling in the resilience lane. The requested
quarantine round leaves that work deferred and does not rerun a full suite or change its runner.

</details>

### Evidence 23

<details>
<summary>2026-10-25-tutorials-track-fix-backoff-verification.md</summary>

[Original report](https://github.com/latchkostov/diagrams/blob/e5dac41b22235302983cfb3d46409d8a0560d9cb/docs/backlog/2026-10-25-tutorials-track-fix-backoff-verification.md).

## PR #344 fix-round backoff timeout evidence

The requested `src/tutorials` unit run reported **1 failed, 2,316 passed, 98 skipped**.
Its only failure was the existing `completionSweep.test.ts` regression
`backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`,
which exceeded its unchanged 5,000 ms timeout. The track-order and gateway recovery tests passed.

A clean tracked-file snapshot of `origin/master` at
`5c1b901fc269c330aecaaa91a2dfd0a5685fa248`, extracted inside this worktree's ignored
test output directory, reproduced the same timeout in both executions of that case.
Only the named regression ran, with one worker and `--repeats=1` (two executions total).
Vitest reported **Test Files 1 failed (1)** and **Tests 1 failed | 1681 skipped (1682)**,
with two timeout failures for the repeated case. No full suite ran on master.

This corroborates [the earlier backoff timeout evidence](#evidence-20).
Investigate the seeded simulation workload without increasing the timeout or weakening its assertions.

</details>
