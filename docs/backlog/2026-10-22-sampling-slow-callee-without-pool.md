## Sampling accuracy: blocking callers whose callee outlasts their threads

A sampled caller that blocks on a callee slower than its own threads turn over models the wait as a stretched hold
("stretch service"), not as requests queueing for threads. It finishes a different number of requests than scale 1
fed at the same arrival instants, on master and after sampling 8a-pre, whose real-unit prefetch widened two cases.
Final real caller completions:

| Case                                                                               | Scale | Same-arrivals scale 1 | Master | 8a-pre |
| ---------------------------------------------------------------------------------- | ----: | --------------------: | -----: | -----: |
| `blocking-call` free play (60 s)                                                   |    10 |                11,854 | 13,710 | 14,643 |
| `scale-on-busy-threads` blocking (and its corpus copy)                             |     2 |                11,928 | 11,982 | 11,993 |
| Slow one-slot callee (30 ms), caller 4 slots, no pool (`scaleEquivalence.test.ts`) |    10 |                   662 |    570 |    570 |

The first is a named `it.fails` (outside the I1 bound) with an exact sibling, and the second an exact pin (inside the
I1 bound, but more than a dot further from scale 1 than master), both in `src/sim/sameArrivalsGoldens.test.ts`. The
third was already a named gap. The joint design's PR 9 spike ("stretch service, not queueing") owns the class: a
first attempt broke `waits.sampling.test.ts`'s nested-caller delay bound, so it needs its own design.

## Sampling accuracy: managed nodes that neither call nor are called reject whole dots

Admission splits or stretches a dot only on partial-occupancy nodes (processors that call, or are called). A managed
node outside the call graph, such as a Lambda with `maxConcurrency: 1` fed by a queue, needs room for the whole dot,
so at scale 4 it refuses every dot of four where scale 1 admits one request at a time: zero completions against 499.
This is the same on master. Sampling 8a's throttle split covers partial-occupancy nodes; extending it to these nodes
(a split dot holds its own size, so no fractional lease is needed) is a follow-up decision.

## Latency samples weigh their dots

Since 8a-pre a sample weighs `unitsOf(message)`: a dot a broker delivers in parts adds up to one sample, and Billing
spike's waiting share stays 78% (it read 82% with a sample per part). Sample counts in frames and reports can be
fractional, rounded to 1e-9 dots like other counters.
