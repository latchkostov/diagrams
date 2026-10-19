## Recovery after capacity edits (PR #206)

Requests interrupted by an outage can resume when a concurrency cap shrinks, including
sampled requests representing four messages under a cap reduced from four to two or one.
Fresh admission, continuations and recovery share the same partial-weight allocator.
Recovery preserves represented work, remaining processing and retry timing, and spent
quota credit; ledger holds use the granted request and thread weights with the existing
represented-count/weight formula.

Recovery also observes endpoint and shared limits added during an outage. Existing
occupancy can drain after a live cap reduction, while additional allocations must fit
the current cap. Admission diagnostics track that retained excess separately and preserve
it through checkpoints. Trace lookups stop at a matching working message without scanning
the remaining queues.

Regressions cover reduced and newly added caps, atomic refusal without quota changes,
retained occupancy, and lazy trace lookups. Generated command sequences edit concurrency
and maxInFlight during outages, including scale four. No tolerances or parity goldens
change; every existing golden must remain identical.
