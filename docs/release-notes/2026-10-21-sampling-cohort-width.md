## Sampling accuracy: cohort width and pool turnover

A sampled dot now carries a width: how many of its represented requests can occupy capacity at once further down its path. A held caller thread or a finite connection pool narrows it, and it never grows again. The callee's thread grant, recovery and continuation takeovers all respect it. Unbounded pools ignore width. A CPU callee behind one connection used to run each cohort's first wave min(N, slots) wide on one core. It now runs at the connection's grant, so at scale 2 it completes 400 real requests instead of 286, against the same-arrivals scale-one reference of 399. `cohort(work)` still sets the represented size behind every counter, CPU charge and hold; width only caps the weight granted to that cohort.

A blocking caller thread wider than the pool lease it waited on doesn't become admissible before that lease's exact turnover. The floor bounds the thread's admissible end, so the caller's own admission lag isn't added on top. A pool at least as wide as the thread adds no floor: its hold is nested in the thread's hold and stretched by no more, so it always turns over first. Fragmentation at scale 10 improves from 580 to 1,000 against 995. Release quantization, `allocationWeight`'s rule and the admission lag are unchanged. Packed weights a rounding error below one real request now snap to that minimum instead of being refused.

## Accuracy comparison

Measured with src/test/scaleEquivalence.ts, seed 7, 100 real requests/s, 20 seconds; master eb0ae67434f996861ae74f021fc076d13b40f4bb. C / R means real caller completions / rejections, rounded here to two decimals. Every row is unchanged or closer to its same-arrivals reference.

| Fixture                         | Scale | Same-arrivals scale 1 C / R |     Master C / R |     Branch C / R |
| ------------------------------- | ----: | --------------------------: | ---------------: | ---------------: |
| Managed zero-work, zero network |  1.01 |                  990 / 1009 | 669.63 / 1329.16 | 669.63 / 1329.16 |
| Managed zero-work, zero network |   1.1 |                  909 / 1090 |   699.6 / 1299.1 |   699.6 / 1299.1 |
| Managed zero-work, zero network |     2 |                  999 / 1000 |      1000 / 1000 |      1000 / 1000 |
| Managed zero-work, zero network |   2.5 |                  799 / 1200 |      1000 / 1000 |      1000 / 1000 |
| Managed zero-work, zero network |    10 |                  199 / 1800 |      1000 / 1000 |      1000 / 1000 |
| CPU standalone                  |  1.01 |                     199 / 0 |       182.81 / 0 |       182.81 / 0 |
| CPU standalone                  |   1.1 |                     199 / 0 |        199.1 / 0 |        199.1 / 0 |
| CPU standalone                  |     2 |                     199 / 0 |          200 / 0 |          200 / 0 |
| CPU standalone                  |   2.5 |                     199 / 0 |          200 / 0 |          200 / 0 |
| CPU standalone                  |    10 |                     198 / 0 |          200 / 0 |          200 / 0 |
| CPU callee, one connection      |  1.01 |                     399 / 0 |       398.95 / 0 |       398.95 / 0 |
| CPU callee, one connection      |   1.1 |                     399 / 0 |        399.3 / 0 |        399.3 / 0 |
| CPU callee, one connection      |     2 |                     399 / 0 |          286 / 0 |          400 / 0 |
| CPU callee, one connection      |   2.5 |                     399 / 0 |          285 / 0 |          400 / 0 |
| CPU callee, one connection      |    10 |                     397 / 0 |          180 / 0 |          400 / 0 |
| Legacy queue worker             |  1.01 |                    1997 / 0 |      1996.77 / 0 |      1996.77 / 0 |
| Legacy queue worker             |   1.1 |                    1997 / 0 |       1996.5 / 0 |       1996.5 / 0 |
| Legacy queue worker             |     2 |                    1997 / 0 |         1998 / 0 |         1998 / 0 |
| Legacy queue worker             |   2.5 |                    1996 / 0 |       1997.5 / 0 |       1997.5 / 0 |
| Legacy queue worker             |    10 |                    1989 / 0 |         1990 / 0 |         1990 / 0 |
| Sub-tick work                   |  1.01 |                     499 / 0 |       498.94 / 0 |       498.94 / 0 |
| Sub-tick work                   |   1.1 |                     499 / 0 |        499.4 / 0 |        499.4 / 0 |
| Sub-tick work                   |     2 |                     499 / 0 |          500 / 0 |          500 / 0 |
| Sub-tick work                   |   2.5 |                     499 / 0 |          500 / 0 |          500 / 0 |
| Sub-tick work                   |    10 |                     497 / 0 |          500 / 0 |          500 / 0 |
| Lambda join                     |  1.01 |                  494 / 1503 | 398.95 / 1598.83 | 398.95 / 1598.83 |
| Lambda join                     |   1.1 |                  484 / 1513 |   399.3 / 1598.3 |   399.3 / 1598.3 |
| Lambda join                     |     2 |                  499 / 1498 |       500 / 1498 |       500 / 1498 |
| Lambda join                     |   2.5 |                  399 / 1597 |     500 / 1497.5 |     500 / 1497.5 |
| Lambda join                     |    10 |                  398 / 1592 |       500 / 1490 |       500 / 1490 |
| Fragmentation                   |  1.01 |                     999 / 0 |       998.89 / 0 |       998.89 / 0 |
| Fragmentation                   |   1.1 |                     999 / 0 |        998.8 / 0 |        998.8 / 0 |
| Fragmentation                   |     2 |                     999 / 0 |         1000 / 0 |         1000 / 0 |
| Fragmentation                   |   2.5 |                     998 / 0 |         1000 / 0 |         1000 / 0 |
| Fragmentation                   |    10 |                     995 / 0 |          580 / 0 |         1000 / 0 |

## Correction to the approved guard

The design applied the guard as `releaseAt = max(releaseAt, notBefore)` on every blocking branch. Measured on the current code, that regressed sub-tick work at 1.01 (402.99 versus 499) and 1.1 (438.9), and left the CPU callee at 2.5 at 357.5. There were two causes:

- The floor was applied before the thread's admission lag, so the lag was added on top of the pool's turnover. Bounding the admissible end instead gives 400 at 2.5, 5 and 10.
- A pool as wide as the thread can't turn over after it, but its lease starts at a whole tick when its fractional credit expired before the branch reached it, one tick after the caller's backdated admission. Its computed turnover then trails the caller's exact turnover by most of a tick each cycle. Recording the floor only for a pool narrower than the thread restores sub-tick work to 498.94 and 499.4.

Both rules are pinned. Guarding every pool fails the sub-tick accuracy rows, and stacking the lag fails the CPU-with-pool I1 regression at 2.5. Capping width on unbounded pools fails "unbounded pools take no width-capped lease".
