## Engine R4 final owner-approved fixes

A partial first wave now executes at the CPU rate its reserved real requests can occupy.
Ten one-core replicas cannot finish one reserved 100 CPU-ms request in 10 ms; its completion
matches scale one within a simulation step. The cohort's remaining CPU continues in its tail.

Numbered replica CPU tails now obey the same termination grace as sampled ranges. One deadline
helper drives tail cancellation, thread-grace scheduling and grace-event release, including a
paused partial admission followed by a return to scale one and a replica shrink.

A saved simulation can take a caller down, bring it up and enable resources while lowering
concurrency in one tick. Resource initialization now returns acquisition failure when retained
work cannot obtain execution capacity; that work queues with its remaining timing and spent
quota intact. The execution invariants remain assertions. The command generator also exercises
this lifecycle batch before advancing the clock.
Seed `-616590097` additionally covers a broker continuation in that batch: failed resource
acquisition wakes and readmits the delivery through its group gate before it enters the queue.
This preserves the broker slot as well as execution admission.

## Scope and validation

Named regressions reproduce all three reported P1s. The recovery case also covers a quota that
admits exactly four requests. Shape focus and connector geometry remain outside this round.
No UI controls, text, schemas, planning behavior or public example feature is added.

The CPU oracle independently enforces the per-step reserved-capacity ceiling while preserving
its total-work and backlog conservation checks. Seed `-1297886043` exposed the old oracle's
assumption that a retry must spend its prior tail only after its new wave; the focused retry
regression now proves both can compete without exceeding the first wave's rate.

Full output parity passes: 2,717 goldens, zero changed, added, missing or stale, including all
93 Linux browser cases. No golden is re-recorded. Regeneration refreshes the embedded skill viewer.
