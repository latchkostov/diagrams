## Pooled route completion accounting (PR #316, fix round 1)

Dispatching the last queued member of a pooled request cohort now releases its template's message and lineage ownership without completing its request route. Actual journey completion owns route credit. Failed or rejected calls no longer acquire premature completion credit or count as both completed and rejected.

Regressions cover a fully granted scale-ten cohort with ten connections and a finite deadline, across successful, failing and rejecting callees. They check route counters before completion, final real outcomes, absence of double counting, and message/lineage cleanup. The ledger oracle also reconciles outstanding cohort weight with unsent weight plus the represented weight of in-flight leases; negative cases cover lost ownership and an incorrect outstanding decrement.

Temporarily restoring template journey completion and removing the conservation check makes all four new regression cases fail, including both negative oracle assertions. The restored fixes pass the targeted simulation tests.

## Output parity

Node parity checked all 3020 goldens: 0 changed, 0 added, 0 missing and 0 stale. No goldens were re-recorded.
