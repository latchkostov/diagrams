## P2 triage: Engine and sampling (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 22 / STALE 0 / OPEN 15 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. DONE means code and/or the specifically requested regression exists with merged-PR evidence; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Attempt and held-call ownership (1 OPEN)

1. **ES-05 — OPEN: Minimize the fractional managed-retry held-call leak.** `src/sim/engine.ts:243`. Queue: #236 sweep.
   Seed 453919836 reports a committed attempt reused by a new continuation at scale 1.5, leaving held=1. Preserve a local minimal fixture if the historical temporary artifact is unavailable, replay it on current master and fix attempt/lease ownership only after reproduction.

## Batch 2: Narrowed caller outcomes (1 OPEN)

1. **ES-06 — OPEN: Split caller outcomes for narrowed successful breaker probes.** `src/sim/engine.ts:1971`. Queue: #253 residual.
   Connections split probe units but the caller retains one dot outcome. Model a call-level sibling for the refused fraction while preserving thread, broker and upstream leases; compare same-arrival scale-one outcomes and checkpoints.

## Batch 3: Verified recovery paths (4 OPEN)

1. **ES-08 — OPEN: Verify every retried connection before reporting recovery.** `src/live/resilienceFixPlan.ts:71`. Queue: #245/#251 r3.
   A successful selected edge must not hide an unhealthy retried sibling. Check each relevant path and add a multi-edge regression with one recovered and one failing connection.

2. **ES-09 — OPEN: Verify recovery for directly injected traffic.** `src/sim/recoveryEvidence.ts:38`. Queue: #250 r2.
   A source-only evidence plan can exclude valid manual injection. Represent replayable injected demand explicitly and retain the no-traffic refusal when evidence cannot certify recovery.

3. **ES-18 — OPEN: Retry-storm Apply fix survives persistence and Undo.** `tests/e2e/ux-resilience-followup.spec.ts:20`. Queue: #245/#251 r3.
   Replay-only plan tests do not prove the editor transaction. Apply the verified retry fix, reload the saved diagram, undo and verify the exact original request settings.

4. **ES-36 — OPEN: Keep active gateway calls in recovery paths.** `src/sim/recoveryEvidence.ts:45`. Queue: #245.
   Recovery walks role-sensitive active calls. Add a gateway request-path fixture and ensure recovery evidence includes its real synchronous dependencies before claiming a fix.

## Batch 4: Admission modes and retry accounting (2 OPEN)

1. **ES-07 — OPEN: Use explicit admission-behavior modes.** `src/sim/admission.ts:332`. Queue: #238/#245.
   Positional flags obscure first-wave, retry and continuation policies. Introduce a typed mode at the internal boundary and keep every existing admission/counter golden unchanged.

2. **ES-10 — OPEN: Encapsulate retry-window reclassification.** `src/sim/engine.ts:2147`. Queue: #251 r3.
   Counter corrections scattered across engine paths can diverge. Move reclassification into the breaker/window owner and test retry, local refusal, timeout and checkpoint paths.

## Batch 5: Sampling regression contracts (3 OPEN)

1. **ES-11 — OPEN: Restore retry-backlog versus first-wave CPU contention coverage.** `src/sim/cpuTail.test.ts:15`. Queue: #238 final (two occurrences).
   The throttle-split work replaced the earlier binding contention case. Run backlogged retries alongside fresh first-wave work, assert both progress and CPU ownership, and mutation-check removal of contention.

2. **ES-15 — OPEN: A finite pool wider than its caller must not trigger the guard.** `src/sim/waits.sampling.heavy.test.ts:285`. Queue: #231.
   Existing narrow-pool cases do not prove the inverse. Set pool width above caller capacity and compare throughput/outcomes with the unconstrained pool at the same arrivals.

3. **ES-17 — OPEN: A retried narrowed probe completes its entire caller route.** `src/sim/breaker.sampling.heavy.test.ts:65`. Queue: #253 final.
   The route-credit statement is not independently pinned. Enable routing in the allowed retry-budget fixture, require sent=completed=200 and a fully drained engine; mutation-check removing route credit.

## Batch 6: Evidence comparison and draft guards (3 OPEN)

1. **ES-01 — OPEN: Preserve nested property reference shortcuts.** `src/canvas/checks/simulationRuns.ts:47`. Queue: #173 (four repeated reference-fast-path findings).
   basisOf creates fresh projected arrays, so the top-level equality check serializes unchanged descendants on every edit. Compare projected records field by field, preserving props/simulation references; count descendant reads rather than stringify calls.

2. **ES-03 — OPEN: Pin the invalid-draft Save guard.** `src/live/SimPanel.tsx:478`. Queue: #173.
   The UI disables Save, but the queue's invalid-fault draft regression is missing. Open a valid saved drill, make it invalid, attempt Save and assert the saved definition/playback remains unchanged.

3. **ES-35 — OPEN: Measure descendant comparison work.** `src/canvas/checks/simulationRuns.test.ts:8`. Queue: #175/#173.
   Counting JSON.stringify calls misses serialization of a much larger subtree per call. Count descendant reads at two sizes and verify a deliberately eager serialization fails.

## Batch 7: Bounded target-specific findings (1 OPEN)

1. **ES-04 — OPEN: Look up omitted findings by target.** `src/lib/requestCheckCache.ts:8`. Queue: #230.
   The inspector reads a bounded whole-diagram result, hiding findings after the output cutoff. Add a bounded target-scoped worker/cache request with cancellation and verified-fix support, preserving existing budgets.

## Closed or superseded findings

| ID    | Status | Finding and current evidence                                                                                                                                                                                                                                                        | Fixing PR / reason                                       |
| ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| ES-02 | DONE   | **Preserve playback when a saved fault drill is rejected** — `src/live/controller.ts:1079`. Fault validation occurs before cancelReplay and simulation replacement, so a rejected saved drill leaves the existing run intact.                                                       | [#173](https://github.com/latchkostov/diagrams/pull/173) |
| ES-12 | DONE   | **Expected I1 failures must reject only the documented mismatch** — `src/sim/scaleEquivalence.heavy.test.ts:254`. Simulation and verification run outside it.fails; exact siblings pin every node outcome and downstream timeout/late reply before the isolated accuracy assertion. | [#227](https://github.com/latchkostov/diagrams/pull/227) |
| ES-13 | DONE   | **Standalone retry CPU retention without an outage** — `src/sim/engineR4.review.test.ts:97`. The named regression runs retained retry CPU with scale edits but no outage and checks unfinished CPU and final outcomes.                                                              | [#229](https://github.com/latchkostov/diagrams/pull/229) |
| ES-14 | DONE   | **Roundoff immediately below integer allocation capacity** — `src/sim/ledger.test.ts:56`. The parameterized regression checks room immediately below every integer independently of allocator output.                                                                               | [#233](https://github.com/latchkostov/diagrams/pull/233) |
| ES-16 | DONE   | **Copied counters exclude inherited prototype entries** — `src/sim/partialDots.test.ts:485`. An enumerable inherited member is explicitly absent after roundCounts, supplementing prototype-named own route IDs.                                                                    | [#238](https://github.com/latchkostov/diagrams/pull/238) |
| ES-19 | DONE   | **Preserve fault validation causes** — `src/model/faultRuntime.ts:106`. Fault grammar and missing-target causes return their own messages rather than being converted to a generic work-budget failure.                                                                             | [#178](https://github.com/latchkostov/diagrams/pull/178) |
| ES-20 | DONE   | **Tiny reservations cannot become permanent** — `src/sim/ledger.test.ts:555`. The named regression bounds fractional releases independently of ordinary whole requests.                                                                                                             | [#204](https://github.com/latchkostov/diagrams/pull/204) |
| ES-21 | DONE   | **Wall-time reservations require a wall clock** — `src/sim/ledger.ts:53`. The ledger distinguishes active owner clocks and wall-clock reservations explicitly.                                                                                                                      | [#204](https://github.com/latchkostov/diagrams/pull/204) |
| ES-22 | DONE   | **Independent multi-group draining ownership** — `src/sim/threadTail.test.ts:343`. The follow-up adds allocations/drainOwners assertions at scales 1 and 10, not just desired replicas and read counts.                                                                             | [#205](https://github.com/latchkostov/diagrams/pull/205) |
| ES-23 | DONE   | **Full-request admission tolerates subtraction roundoff** — `src/sim/ledger.test.ts:1022`. A named regression pins the fractional subtraction boundary.                                                                                                                             | [#211](https://github.com/latchkostov/diagrams/pull/211) |
| ES-24 | DONE   | **Incremental admission reconfiguration** — `src/live/controller.test.ts:136`. Managed input and diagram edits batch into one reconfiguration rather than rebuilding for each setter.                                                                                               | [#211](https://github.com/latchkostov/diagrams/pull/211) |
| ES-25 | DONE   | **Shared-cap regression is independently binding** — `src/sim/engineR3.review.test.ts:312`. The review suite has separate shared admission/caller ownership assertions.                                                                                                             | [#211](https://github.com/latchkostov/diagrams/pull/211) |
| ES-26 | DONE   | **Zero-CPU scale-tail invariant** — `src/sim/cpuTail.test.ts:333`. The named paused scale-transition and continuation tests retain replica ownership without CPU work.                                                                                                              | [#215](https://github.com/latchkostov/diagrams/pull/215) |
| ES-27 | DONE   | **Scale edits preserve weight and successful continuation** — `src/sim/cpuTail.test.ts:397`. Queued continuations use their original real request weight after the scale edit.                                                                                                      | [#215](https://github.com/latchkostov/diagrams/pull/215) |
| ES-28 | DONE   | **Numbered CPU tails survive until grace expires** — `src/sim/cpuTail.test.ts:442`. The named unanswered-call ownership regression pins final release after grace.                                                                                                                  | [#215](https://github.com/latchkostov/diagrams/pull/215) |
| ES-29 | DONE   | **Broker continuation is queued before cleanup assertions** — `src/sim/cpuTail.test.ts:481`. The shrink regression establishes the intermediate continuation and old tail before final cleanup.                                                                                     | [#215](https://github.com/latchkostov/diagrams/pull/215) |
| ES-30 | DONE   | **I7 scale-four CPU ownership counterexample** — `src/sim/cpuTail.test.ts:237`. A named seed regression now covers numeric-replica ownership when a sampled neighbor appears.                                                                                                       | [#233](https://github.com/latchkostov/diagrams/pull/233) |
| ES-31 | DONE   | **Skip exhausted CPU keys before tail grouping/sorting** — `src/sim/cpuTailShares.test.ts:58`. The named operation-count-sensitive case retains owed CPU while skipping exhausted keys.                                                                                             | [#233](https://github.com/latchkostov/diagrams/pull/233) |
| ES-32 | DONE   | **Checkpoint coverage detects lost owed CPU** — `src/sim/cpuTail.test.ts:153`. Continuing contention after restore pins repayment rather than only snapshot equality.                                                                                                               | [#233](https://github.com/latchkostov/diagrams/pull/233) |
| ES-33 | DONE   | **Generated recovery requires eventual cleanup** — `src/sim/ledger.commands.test.ts:280`. The generated shared-caller recovery calls the bounded drain helper and checks successful recovery.                                                                                       | [#245](https://github.com/latchkostov/diagrams/pull/245) |
| ES-34 | DONE   | **Narrow retry size is applied before route sent accounting** — `src/sim/engine.ts:1971`. The route-sent fix was merged after #247's review and counts only admitted units.                                                                                                         | [#256](https://github.com/latchkostov/diagrams/pull/256) |
| ES-37 | DONE   | **Recovery regression asserts completed deliveries** — `src/sim/engineR3.review.test.ts:419`. The lowered-cap recovery case pins both caller completion and downstream result processing, not just empty bookkeeping.                                                               | [#211](https://github.com/latchkostov/diagrams/pull/211) |

## Scope and verification

This is a documentation triage, not an implementation or a new reproduction run. Before taking a batch, recheck its OPEN entries against the then-current master, run the named regression family, and retain any reduced fixture or trace. Tests/CI batches may take separate runner investigations; stop at the bounded evidence step rather than weakening assertions. No application code or output golden changes belong to this triage.
