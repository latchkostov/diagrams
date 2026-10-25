## Pool cohorts and shedding queues (PR #316: R-21c7562a21, R-8e6e356e3c)

**Gap.** When a queue sheds part of a pooled cohort's wave, `splitShed` handles only the caller's branch. For a bound branch it narrows the branch and its deadline event and counts the shed members as edge failures. An orphan's branch is not touched at all. The owning cohort in `src/sim/poolCohort.ts` is not told either way: its `outstanding` and that wave's `inFlight` weight still include the shed members. Three counterexamples, each with the cohort path forced by the test-only `shedCohorts` option, are in `poolCohort.test.ts`:

- **Bound, whole cohort sent.** Scale 10, ten connections, a paused callee with `queue: { limit: 1 }`. It sheds nine. Expiry counts all ten again: 10 timeouts and 19 failures, against 1 and 10 at scale 1. Pinned by `it.fails("R-21c7562a21: a cohort's partially shed members leave its timeout accounting")`.
- **Bound, partly sent.** Five connections, and the queue is added while five members travel. It sheds four, and the five unsent members must still time out: 6 timeouts and 10 failures are expected, 10 and 14 are recorded. Pinned by `it.fails("R-8e6e356e3c: a partially shed cohort keeps its unsent members' timeouts")`.
- **Orphan.** Five connections, a callee with concurrency 1, 50 ms latency and `queue: { limit: 1 }`, two dots. Shed members never count as edge failures: 8 shed and 0 failed. Pinned by `it.fails("R-21c7562a21: an orphan's partially shed members fail on the edge")`, which expects 8 and 8.

Ordinary tests pin the numbers each forced path records today.

**Quarantine.** PR #316 used its fix rounds, so shedding never reaches a cohort:

- **Diagram-level opt-out** (`openPoolCohort` in `src/sim/engine.ts`). While any node has a queue policy, from load or through a live edit, no cohort opens and calls take the pre-8b whole-dot path; a run with a queue from the start is exactly the run with cohorts disabled. The check reads the current props, so it needs no state of its own and checkpoints restore it with the diagram. Once the last queue is removed, new calls may open cohorts again. That is safe: with no queue nothing can shed, and the next rule exempts their members from any queue added later. (A sticky run-level flag cost about 165 B of skill ZIP, because the new closure variable re-mangles the whole bundle, against 71 B of headroom.)
- **Open cohorts keep their members.** `queueEligible` treats a cohort wave like a broker delivery or a continuation: a queue enabled while that cohort is open never queues it under its policy, never evicts it and never sheds it. Those cohorts finish under their own tested transitions. Every member is still counted exactly once: sent ones reply or time out (and reply late), and unsent ones time out.
- **Accuracy cost.** It is bounded by the deadline of cohorts open at the edit. For example, adding the queue mid-flight with ten connections records 10 timeouts, 10 failures and 0 shed at scale 10, against 1 timeout, 10 failures and 9 shed at scale 1.
- **Property.** `cohortShedding.invariants.heavy.test.ts` checks this over random pooled-deadline diagrams with live queue and pause toggles, at scales 1 and 10. It checks the ledger and cohort conservation oracle on every tick, and that no cohort opens while a queue exists. It also checks that timeouts equal members − delivered + late (nothing lost, nothing timed out twice), that failures lie between timeouts and timeouts + shed, and that queue-from-load runs equal the cohort-free path.
- **Superseded.** The opt-out replaces the earlier per-callee guard and the `min(outstanding, branch)` expiry settlement.

**Suggested fix.** Add a `shed(lease, weight)` transition to `poolCohort.ts`:

- It is valid in bound and orphan states and ignored when closed.
- It removes the shed weight from that wave's `inFlight` entry and from `outstanding`, so conservation (outstanding = remaining + Σ inFlight) still holds.
- In orphan state it returns a `failed` effect for the shed weight. In bound state it returns none, because `splitShed` already counts that part.
- `splitShed` calls it for cohort waves (`message.cohortId`, `message.poolLease`) instead of narrowing a cohort branch to the kept part.
- It must also decide whether the wave's pool lease keeps its charged weight until the retained part replies (the ledger owns that). The oracle's per-wave lease check must then compare against that rule.
- Then remove the opt-out, the cohort clause in `queueEligible` and the `shedCohorts`/`noCohorts` options. Flip the three `it.fails` to ordinary tests and unit-test the new cells with the same conservation checks.

**Review P2s from the same round, done in PR #316:**

- R-d5b51a40ca: `older pooled cohort dispatches its remaining members before a newer cohort` (`queuedCohort.test.ts`) records each granted lease's cohort and the final caller successes and failures.
- R-9bba034378: the ledger oracle requires each unexpired cohort with unsent members to hold exactly one queued template. `oracle rejects an unsent cohort without a queued template` covers the missing, duplicated and valid cases.
