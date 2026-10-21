## Sampling accuracy: four small-pool corrections

Live preserves sampled throughput more accurately for queue workers, managed request admission,
fractional pool capacity, and services whose local work is shorter than one simulation tick.
Workers now share weighted reservations; due request holds release before admission; fractional
turnover carries into the next cohort; and blocking holds include only their actual admission lag.
Minimum reservation weights and existing accuracy bounds are unchanged.

CPU contention, Lambda joins across ordinary and resource-backed services, and pooled deadlines
remain known approximation gaps. Their named expected failures pin specific mismatches separately
from simulation and ownership checks. Generated I1 runs only with
`node scripts/fc-sweep.mjs --i1`; normal properties and wait tests keep their existing assertions.

## Output review (recording pending)

Four scale-ten goldens differ; scale-one goldens are unchanged. In
`node/sim/blocking-call/free-play.json`, final real caller completions move 13,710→13,670 toward
the 12,000 scale-one reference (difference 1,710→1,670), while store completions move
13,650→13,670 away from 11,960. CPU contention remains a known gap.

In `node/sim/corpus-w1-deadline/blocking-10.json`, mean latency falls 685→680 ms versus 765 ms
at scale one. In `node/sim/corpus-w1-deadline/non-blocking-10.json`, it falls 310→305 ms versus
315 ms. Both retain matching scale-one p50 values, unchanged final outcomes, and new event/rate
samples from earlier turnover. These mean latencies move away from scale one.
`node/waits/w1-deadline/non-blocking-10.json` completes four failure continuations instead of
three at 200 ms: 30→40 real failures versus 32 at scale one. The pooled-deadline approximation
remains unresolved. Full direction notes are in `docs/PARITY.md`; no golden has been re-recorded
while the exact-timing compatibility assertion decision is pending.
