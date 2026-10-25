## Pool cohorts and shedding callee queues (PR #316, R-21c7562a21)

**Gap.** When a callee queue sheds part of a pooled cohort's wave, `splitShed` narrows the caller's branch and its deadline event and counts the shed members as edge failures. The owning cohort in `src/sim/poolCohort.ts` is not told: its `outstanding` and that wave's `inFlight` weight still include the shed members, so `expireCohort` counts them again at the shared deadline.

**Repro** (`poolCohort.test.ts`, cohort path forced with the test-only `shedCohorts` option). The diagram is `waitingFixture` at revision `p3-w2`, scale 10. The caller has a non-blocking call with ten pool connections and a 1000 ms deadline. The callee is paused with `queue: { limit: 1 }`. One dot of ten is injected. The callee sheds nine. Scale 1, and scale 10 on the guarded path, record 1 timeout and 10 failures. The forced cohort path records 10 timeouts and 19 failures for ten sent requests. An ordinary test pins those numbers; `it.fails("R-21c7562a21: a cohort's partially shed members leave its timeout accounting")` expects the scale-1 numbers.

**Quarantine.** PR #316 used its fix rounds, so `openPoolCohort` in `src/sim/engine.ts` doesn't open a cohort when the callee has a `queue` policy. Such calls keep the pre-8b whole-dot path, as on master. The guard checks only at cohort opening. A queue added by a live edit while a cohort is in flight still reaches the gap until that cohort closes.

**Suggested fix.** Add a `shed(lease, weight)` transition to `poolCohort.ts`:

- It is valid in bound and orphan states and ignored when closed.
- It removes the shed weight from that wave's `inFlight` entry and from `outstanding`, so conservation (outstanding = remaining + Σ inFlight) still holds.
- It returns no counter effect, since `splitShed` already counts the shed members as failed.
- `splitShed` calls it for cohort waves (`message.cohortId`, `message.poolLease`) instead of only narrowing `branch.represented`.
- It must also decide whether the wave's pool lease keeps its charged weight until the retained part replies (the ledger owns that).
- Then delete the guard and the `shedCohorts` option, flip the `it.fails` to an ordinary test, and unit-test the new cells with the same conservation checks.

**Review P2s from the same round, done in PR #316:**

- R-d5b51a40ca: `older pooled cohort dispatches its remaining members before a newer cohort` (`queuedCohort.test.ts`) records each granted lease's cohort and the final caller successes and failures.
- R-9bba034378: the ledger oracle requires each unexpired cohort with unsent members to hold exactly one queued template. `oracle rejects an unsent cohort without a queued template` covers the missing, duplicated and valid cases.
