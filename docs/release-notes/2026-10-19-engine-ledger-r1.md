## Engine ledger shell (step 1 of 5)

Pool reservations now live in an independent sampled ledger, with indexed
per-owner release heaps, idempotent cleanup and checkpointed reservation IDs.
Pending calls also have indexed cancellation. Generated command sequences check
leak cleanup, scale-1 empty release heaps, determinism and checkpoint replay.

This is R1 of the approved logical/sampled split. Logical reply timing, CPU and
thread reservations retain their current paths until later steps. The outcome
verification hook is reserved for the attempts migration in R2.

No output golden changes are expected or recorded. Every simulation, planning,
export, layout and other committed output must remain unchanged.
