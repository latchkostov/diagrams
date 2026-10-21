## Blocking pool admission at fractional scale

Executing the formerly dormant blocking connection pool adds a sampled I1 gap. The
zero-work one-slot caller/callee fixture in `src/sim/scaleEquivalence.test.ts`, with
one connection and 10 ms physical travel, completes 999 at scale 1 and 798.91 at
scale 1.01 over 20 seconds. Difference 200.09 exceeds the unchanged bound of 22.
Scale 2.5 still satisfies the bound. The fractional case is a named `it.fails`;
investigate pool-release versus thread-admission ordering in the accuracy work.
Keep the examples at scale 1. The existing pooled-deadline sampled gap remains pinned.
