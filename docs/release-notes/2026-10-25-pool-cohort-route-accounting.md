## Pooled route completion accounting (PR #316, fix round 1)

Dispatching the last queued member of a pooled request cohort now releases its template's message and lineage ownership without completing its request route. Actual journey completion owns route credit. Failed or rejected calls no longer acquire premature completion credit or count as both completed and rejected.

Regressions cover a fully granted scale-ten cohort with ten connections and a finite deadline, across successful, failing and rejecting callees. They check route counters before completion, final real outcomes, absence of double counting, and message/lineage cleanup. The ledger oracle also reconciles outstanding cohort weight with unsent weight plus the represented weight of in-flight leases; negative cases cover lost ownership and an incorrect outstanding decrement.

Temporarily restoring template journey completion and removing the conservation check makes all four new regression cases fail, including both negative oracle assertions. The restored fixes pass the targeted simulation tests.

## Output parity

Node parity checked all 3020 goldens: 0 changed, 0 added, 0 missing and 0 stale. No goldens were re-recorded.

## Pool cohort lifecycle (PR #316, fix round 3)

The pooled-deadline cohort is now an explicit state machine in `src/sim/poolCohort.ts`: bound (the caller awaits its first settled wave), orphan (the first wave replied OK; the rest settle on the edge) and closed. Grant, narrowing, reply, wave failure, expiry, cancellation and breaker refusal each update that state and return ordered effects; the engine still owns caller settlement, edge counters, the ledger and route credit. The full state × event table is in the module's header, and every cell has a direct unit test that also checks conservation (outstanding = unsent + in flight, unsent members keep their template).

Two lifecycle errors are fixed:

- **Cancellation completes no route.** When the first member of a partially dispatched cohort fails or is rejected, its unsent template is released without route credit, as the last dispatch already was. At scale 10 with one connection, a routed call to a failing or rejecting callee now records 0 completions instead of 10.
- **Wave failure keeps orphan work.** After a successful first wave, a later failed wave counts only its own members as failed. The remaining members stay queued under the shared deadline and are still delivered: with the second of ten waves failing, ten are delivered, nine succeed downstream and one call fails on the edge, instead of two delivered and eight lost.

An orphan's breaker refusal now fails only its unsent members; waves already sent keep settling. A template whose deadline passes before its expiry is processed leaves the queue, but its cohort keeps it until expiry settles its members. The ledger oracle checks each in-flight wave against its pool lease and that unsent members always keep their template. Both new regressions fail on the previous head.

## Pool cohorts and shedding queues (PR #316, quarantine)

Pooled-deadline cohorts don't yet reconcile members that a queue sheds from part of a wave. Until a cohort `shed` transition lands, no cohort opens while any queue policy exists, whether from load or from a live edit: such calls keep the pre-8b path, and runs with a queue from the start match it exactly. If a queue is enabled while cohorts are open, those cohorts' members are exempt from it, like broker deliveries and continuations. They finish under the tested cohort rules, counted exactly once each. This replaces the earlier per-callee guard and expiry clamp.

A fast-check property covers random pooled-deadline diagrams with live queue and pause toggles at scales 1 and 10. It checks conservation, no lost or double-counted members, and that runs with a queue from load equal the cohort-free path. Three `it.fails` tests with the cohort path forced pin the shed-inside-cohort gaps for the future fix. See [the backlog entry](../backlog/2026-10-25-cohort-shedding-timeouts.md).
