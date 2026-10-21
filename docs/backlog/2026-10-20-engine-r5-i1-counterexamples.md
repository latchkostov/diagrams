## Sampling accuracy

PR A fixes the four cases below while preserving the existing properties and bounds. Generated
I1 remains an opt-in exploration, not a CI gate: run `node scripts/fc-sweep.mjs --i1`.
The runner sets `FC_I1=1`, checks the full generated corpus without exclusions, and reports every
failing seed with fast-check's shrink path and counterexample, continuing across seeds. Normal
sweeps explicitly clear that flag. New counterexamples must become named `it.fails` regressions
with their exact observed mismatch pinned outside the expected failure; crashes must fail normally.
The wait-test wrappers are deferred until I1 can become a gate. No existing generator or assertion
is weakened or filtered.

These cases inject 100 real requests/s for 20 seconds, quantized at cohort boundaries, with seed 7.
Numbers below are real caller/worker completions, not dots.

## Integration pending

The four named fixes and their second-scale siblings pass; all eight fail on throughput when
the engine corrections are temporarily reverted. The focused suite passes 171 tests with five
expected failures. Existing generated properties and wait tests are restored to master.

Landing still needs a contract decision about exact schedule expectations: the fragmentation fix
dispatches two cohorts at 10 ms where `ledger.differential.test.ts` pins one. The shared standalone
worker lifecycle also answers its first wave before its retained hold ends, conflicting with six
R4 schedule assertions. `threadTail.test.ts` and `r4Final.review.test.ts` each retain one observation
of the previous schedule. Do not loosen invariant bounds or regenerate the historical master
traces to hide these conflicts. Reconcile the intended exact schedules explicitly first.

The first full unit run failed on these integration assertions and a worker crash; a concurrent
temporary runtime experiment also invalidated its typecheck result. The restored focused suite
and explicit typecheck must be used for the current patch, followed by a clean full run once the
schedule contract is resolved. Full browser parity passes all 95 tests; four scale-ten records
differ and remain unrecorded, with direction notes in `docs/PARITY.md`. Normal sweep attempts
were refused by the occupied shared worker budget, so no fresh-seed completion is claimed.

## Legacy queue workers

One resource-backed queue worker outside the call graph, one slot, 10 ms local latency and zero
CPU: scale 1 completes 1,998; scale 1.01 completes 1,008.99. Allowed difference: 41.98.
There are no request calls or connection pools. The legacy `serviceCredit` path survives for
nonparticipants; trace fractional credit and the next admission tick.
Generated parent: seed `20261018`, path `0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:2:2`.

Cause established: nonparticipant processors acquire execution reservations but release them
immediately and separately pace admission with `serviceCredit`. Its capped credit and admission
tick rounding discard fractional service capacity. The fix puts every W1 processor on the
same weighted thread/request lifecycle and first-wave CPU accounting; historical revisions still
need the legacy credit path. The named cases pass at scales 1.01 and 2.5.

## Managed request admission

A fixed one-slot Lambda caller, 10 ms API work, one connection and a zero-work service callee,
fed by a queue: scale 1 completes 666; scale 1.01 completes 335.32. Allowed difference: 15.34.
The caller does real API work; its retained managed lease gates admission. Trace request release
versus admission ordering and retained holds. The zero-local-work correction does not apply.
Diagnostic parent: seed `20261018`, path
`0:1:0:0:0:1:1:0:0:0:0:0:0:0:0:0:0:0:0:1:2:2`, with independent siblings removed.

Cause established: arrivals can check admission before due request leases release. Thread and
request holds also round independently; when a new delivery first becomes eligible on the release
tick, rounding every exact turnover upward loses service capacity repeatedly. The fix
releases due ownership before arrivals and carries exact fractional turnover, including debt when
the release occurs on the preceding tick. Logical settlement still bounds every release. Cases
at scales 1.01 and 2.5 pass without changing I1.

## Fractional capacity fragmentation

Two zero-work caller slots, one zero-work callee slot and one connection: scale 1 completes
1,998; scale 1.1 completes 1,098.9. Allowed difference: 42.16. A cohort reserves 1.1 real units,
leaving 0.9; the minimum-one-real-request gate refuses another cohort. This occurs without a
retained thread hold and is independent of the zero-work admission-lag correction.
Diagnostic parent: seed `20261018`, path `3:0:1:1:1:1:1:0:0:0:0:0:0:0:0:1`.
Preserve the small-reservation guards when investigating fragmentation.

Cause established: greedily granting 1.1 of two slots strands 0.9 behind the one-request minimum.
The fix's shared allocator balances grants across the finite room (two grants of one in this
case), retaining the minimum-weight guard instead of introducing tiny leases. The named cases
pass at scales 1.1 and 1.5. Admission and the ledger use the same allocation helper.

## Sub-tick local work

Two ordinary one-slot, one-replica services each have 1 ms local work and zero jitter. Their
Request uses one connection, blocking wait, zero reply work and 10 ms physical network delay.
Scale 1 completes 499; scale 2 completes 400. Difference 99 exceeds the I1 bound 13.98.
Generated seed `20261018`, shrink path `1:1:0:0`.
There are no managed limits, legacy resource workers or unequal finite pools. Each reservation
fills its one-slot pool, so this is not leftover fractional capacity.
Replay: `CI=true pnpm exec vitest run src/sim/scaleEquivalence.test.ts -t "1 ms local work"`.

Cause established: nonzero local work selects the unconditional blocking admission lag even when
the reply settles in the incoming phase, before this tick's work/admission. That stretches an extra
tick with the cohort. The fix supplies the actual admission phase to the execution helper;
post-admission replies retain their lag. Cases at scales 2 and 3 pass. A sibling with resource-backed
fan-out also checks that zero local work cannot erase a real post-admission lag.

## CPU-contention feedback

The reduced diagram has a two-slot, zero-local-work caller and a two-slot callee on one CPU core,
with 24 ms CPU per request, zero local latency, blocking wait and 10 ms network delay in each
direction. At 100 real requests/s over 20 seconds, scale one completes **570** caller requests;
the fix at scale 1.1 completes **664.4**. Difference **94.4**, unchanged I1 bound **13.6**.
The expected-failure regression is `I1 known gap: CPU-contention throughput (570 versus 664.4,
bound 13.6)`. Simulation and invariant checks run in `beforeAll`; a separate ordinary test pins
both counts, so an unrelated crash or changed fixture cannot satisfy the expected failure.

Generated seed `20261018`, path `3:1:0:0:0:2:2:1:1:1:1:0:0:0:0:0:0:0:2:0:3:2`.
The generated parent includes a zero-work sibling; removing it preserves the mismatch.

The trace shows the mechanism: scale-one callers repeatedly start ten milliseconds apart and
complete paired CPU waves on a seventy-millisecond cycle. Sampled retained holds change that
spacing. The CPU tails remain charged, but subsequent first waves run with different contention;
their shorter observed hold feeds back into `T = H + admission lag`, producing another schedule.
This is not just a lost fractional release: restoring exact, unrounded release deadlines in the
prototype gives the same 664.4 completions. The regression also fails against the original engine
at `b642f42a` (570 versus 366.3), before these changes.

Orchestrator decision: this is the sixth known gap and gets a separate design. PR A chooses
neither candidate model:

- A scale-one contention model for retained holds would preserve the current first-wave logical
  CPU timeline and outcome independence. It would require counterfactual scheduling alongside the
  real CPU ledger, including overlap, replica ownership and retries, and would replace R3's
  observed-H hold with an estimated turnover. The two timelines could disagree about residence.
- Changing first-wave CPU timing could preserve contention directly in the logical schedule and
  keep retained holds tied to observed H. It changes R4's independently executing first waves,
  logical reply times and deadline races, so it needs an explicit semantics decision and I7 review.

Work item: decide the contention model before changing retained CPU holds or first-wave timing.
There is no I1 exclusion predicate; exploration deliberately rediscovers known gaps.

## Lambda joins ordinary and resource-backed replies

Enabling I1 with the two exclusions finds another counterexample at seed `20261018`, path
`5:1:1:1:1:1:1:1:1:0:0:0:0:0:0:0:0:0:0:0:0:0:0:2:2:2`. The generated graph completes
499 managed-caller requests at scale 1 and 200 at scale 4, against the unchanged bound 17.98.
All active CPU work is zero and there are no deadlines.

Removing the shared allocation, competing managed sibling and its external API leaves a smaller
reproduction: a one-slot fixed Lambda caller with 10 ms API work joins two zero-work, one-slot
service callees. One callee is resource-backed with zero CPU; both Requests are blocking, with
one connection and 10 ms network delay. At 100 real requests/s over 20 seconds, scale 1 completes
**499**, scale 4 **400**. Difference **99** exceeds **17.98**. Removing the fleet-backed branch
instead gives **666 versus 668**, within the bound.

The named expected failure is `I1 known gap: Lambda joins ordinary and fleet replies
(499 versus 400, bound 17.98)`. Its ordinary sibling pins both exact counts; simulations and
ownership checks run outside the expected failure. Suspected area: managed request residence
when the final branch settles in a different admission phase. Trace request/thread retirement
and the turnaround chosen for the final joined reply before choosing a fix.

## Pooled deadlines (PR B)

Work item: represent queued members' deadlines independently of the sampled connection hold.
Only already-sent requests can reply late. The scale-ten cohort currently undercounts downstream
completions and late replies; the scale-one pool=1, 100 ms deadline fixture sends one of twenty
requests before expiry. The constant-traffic reference completes 2,964 downstream requests and
late replies over 30 seconds. Existing named expected failures remain in `queuedDeadline.test.ts`,
`deadlines.test.ts` and `deadlineScale.invariants.test.ts`; execution/replay/cleanup run outside
those failures. See the [queued-cohort work item](2026-10-20-deadline-queued-cohorts.md) and
[PR B's design](C:/Users/latch/bin/codex-tasks/rtw3-queued-cohort-design.md).

## Exploration follow-ups

An earlier extra I1 interval in the wait workload generator observed caller rejections **399
versus 440** at scale 2 (bound **37.98**), seed `20261018`, path `12:0:3:0`, input
`[1,14,30,false,2,false,"non-blocking",true]`. Investigate admission rejection accounting when
expanding exploration to that generator. The wrapper change is deferred; its original property
and assertions are unchanged. This observation has not been classified as a distinct root cause.

## Zero-local-work correction retained in R5

Threads with no local work start during admission itself and must not add another work-loop
admission lag to their sampled hold. The named regressions at scales 1.01 and 2.5 keep the original
I1 bound. Without the correction, 999 scale-one completions become 671.65 and 665 respectively
(allowed differences 22 and 24.98). PR A adds the four corrections above without changing this earlier regression or its bound.
