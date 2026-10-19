## Engine attempts R2: preserve capacity and unfinished continuations

Non-blocking callers dispatch their requests at logical local completion while an independent thread
reservation retains the remaining sampled local-work capacity. Its active clock freezes on pause;
down and drain release it without completing work. Continuations can take over their own reservation,
including fractional service credit, instead of waiting behind their own capacity tail. The saturated
20-second probe completes 180 real requests at both scale 1 and scale 10, matching frozen master
`1b72a891d57850743420283d4565d9e968b3405f` at both scales.

A join settled while paused no longer counts as an executed continuation. Taking the caller down
fails that unfinished work and its upstream request without publishing or rewriting the successful
join. Completion, processing failure, routing refusal and managed admission rejection now share
write-once attempt commitment. Retry disposition is computed once before counters and ownership change.

Sampled differential tests now pin explicit R2 checkpoints and completion times. Four additional
divisible-pool scenarios retain complete traces captured from the same frozen master; the original
master traces are unchanged.

The earlier wait-property timeout was aggregate generated work, not a non-terminating path. Its log
contains no fast-check seed/path. Seed `20261018` reproduces the local backstop; replaying the original
property with that seed, path `0`, fivefold runs and the existing CI backstop finishes successfully.
Generated cases now advance at most 60,000 simulated milliseconds per engine and run separately for
all twelve capacities (180 generated cases at fivefold load, up from 150). The named 1-slot/scale-10
extreme remains. Assertions and hang backstops are unchanged.

The fivefold targeted suite passes 256 tests. Temporarily restoring the preceding engine and ledger
fails all nine new lifecycle/admission regression cases. Shifting the recorded timing by one simulation
step fails all twelve restored timing checks. Full parity passes: 2,712 goldens, zero changed, added,
missing or stale (1,596 Node tests and 93 Linux browser tests). No further scale>1 W1 golden changes:
scale-1 and older outputs, and the existing R2 scale>1 W1 goldens, remain unchanged. Production build
and bundle budgets pass: entry 109.0 kB gzip / 123.5 kB; viewer 593.4 kB / 805.0 kB.
