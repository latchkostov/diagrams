## Pool cohorts and shedding callee queues (PR #316, R-21c7562a21, R-8e6e356e3c)

**Gap.** When a callee queue sheds part of a pooled cohort's wave, `splitShed` handles only the caller's branch. For a bound branch it narrows the branch and its deadline event and counts the shed members as edge failures; an orphan's branch is not touched at all. The owning cohort in `src/sim/poolCohort.ts` is not told either way: its `outstanding` and that wave's `inFlight` weight still include the shed members.

**Quarantine.** PR #316 used its fix rounds.

- `openPoolCohort` in `src/sim/engine.ts` doesn't open a cohort when the callee has a `queue` policy, so such calls keep the pre-8b whole-dot path, as on master.
- That guard only applies when a cohort opens. A queue enabled mid-flight can still shed a live cohort's wave (R-8e6e356e3c). For bound cohorts, the engine's `decide` effect settles an expiry at no more than the branch size: `min(outstanding, branch size)`. That is the legacy path's own deadline weight after `splitShed`. Without shedding, the branch size never falls below `outstanding` (`narrowProbe` sets them equal; retries open at the narrowed size), so nothing else changes. Node parity is unchanged.
- Regressions in `poolCohort.test.ts`:
  - `a queue enabled mid-flight sheds a bound cohort's wave without counting it again at expiry` covers adding the queue, and adding then removing it. Both match the scale-1 numbers: 1 timeout, 10 failures, 9 shed.
  - `a cohort's partially shed members leave its timeout accounting` runs the original bound repro with the cohort path forced by the test-only `shedCohorts` option.

**Remaining gap (orphans).** After an OK first wave, the branch is no longer narrowed, so a shed wave's members never count as edge failures. The kept part's reply then removes the whole wave from `outstanding`.

- Repro: `waitingFixture` at `p3-w2`, scale 10, five connections, a 2000 ms deadline, and a callee with concurrency 1, 50 ms latency and `queue: { limit: 1 }`, with two dots injected and the cohort path forced.
- Result: 8 shed, 0 edge failures. Scale 1 records 18 shed and 18 failed; the guarded path records 9 and 9.
- An ordinary test pins the current numbers, and `it.fails("R-21c7562a21: an orphan's partially shed members fail on the edge")` expects 8 and 8.

**Suggested fix.** Add a `shed(lease, weight)` transition to `poolCohort.ts`:

- It is valid in bound and orphan states and ignored when closed.
- It removes the shed weight from that wave's `inFlight` entry and from `outstanding`, so conservation (outstanding = remaining + Σ inFlight) still holds.
- In orphan state it returns a `failed` effect for the shed weight. In bound state it returns none, because `splitShed` already counts that part.
- `splitShed` calls it for cohort waves (`message.cohortId`, `message.poolLease`).
- It must also decide whether the wave's pool lease keeps its charged weight until the retained part replies (the ledger owns that). The oracle's per-wave lease check must then compare against that rule.
- Then delete the guard, the `min` in `decide` and the `shedCohorts` option, flip the `it.fails` to an ordinary test, and unit-test the new cells with the same conservation checks.

**Review P2s from the same round, done in PR #316:**

- R-d5b51a40ca: `older pooled cohort dispatches its remaining members before a newer cohort` (`queuedCohort.test.ts`) records each granted lease's cohort and the final caller successes and failures.
- R-9bba034378: the ledger oracle requires each unexpired cohort with unsent members to hold exactly one queued template. `oracle rejects an unsent cohort without a queued template` covers the missing, duplicated and valid cases.
