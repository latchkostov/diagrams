## Sampling accuracy: CPU tails yield, then repay

When a sampled cohort's thread weight is below the requests it represents, its first wave finishes and the rest of its CPU runs on as a tail. A tail used to take its share of each tick ahead of the next first wave. A tail that forms with less than one request's CPU is the cohort's fractional part, and it now yields. It repays any CPU it is owed before first waves run. First waves then divide the rest of the tick, and the tail takes what they leave. Any fair share it missed is owed again and charged first next tick, but never more than its unfinished CPU. Yielding tails share what is left max-min fairly, so a key's budget stops short only when every tail on it is satisfied.

On the CPU-contention fixture without a pool, the next first wave used to finish a tick late in every cycle, so the two threads drifted apart. It now completes 569.8 real requests at scale 1.1 (was 664.4) and 570.0 at 1.5 (was 664.5), against 570 at scale one with the same arrivals. Every callee first wave is resident for the same time as at scale one, and CPU utilisation is 68.5% at 1, 1.1 and 1.5. The whole-dot scales keep 498 to 500. CPU-bound standalone work at 1.01 moves from 182.81 to 189.88, against 199.

A tail of one or more whole requests keeps its fair share ahead of first waves, as before. Scale one never forms tails, so it is unchanged. Release quantization, allocation weights, width and the pool-turnover floor are unchanged. Owed CPU is per-tail state, so checkpoints and replays keep it.

## Accuracy comparison

Measured with `src/test/scaleEquivalence.ts`: seed 7, 100 real requests/s, 20 seconds; master 6082bfe552a409d218f57f655b61e33d944e6c17. C / R means real caller completions / rejections, rounded here to two decimals. Every row is unchanged or closer to its same-arrivals reference.

| Fixture                         | Scale | Same-arrivals scale 1 C / R |     Master C / R |     Branch C / R |
| ------------------------------- | ----: | --------------------------: | ---------------: | ---------------: |
| Managed zero-work, zero network |  1.01 |                  990 / 1009 | 669.63 / 1329.16 | 669.63 / 1329.16 |
| Managed zero-work, zero network |   1.1 |                  909 / 1090 |   699.6 / 1299.1 |   699.6 / 1299.1 |
| Managed zero-work, zero network |     2 |                  999 / 1000 |      1000 / 1000 |      1000 / 1000 |
| Managed zero-work, zero network |   2.5 |                  799 / 1200 |      1000 / 1000 |      1000 / 1000 |
| Managed zero-work, zero network |    10 |                  199 / 1800 |      1000 / 1000 |      1000 / 1000 |
| CPU-bound standalone            |  1.01 |                     199 / 0 |       182.81 / 0 |   **189.88 / 0** |
| CPU-bound standalone            |   1.1 |                     199 / 0 |        199.1 / 0 |        199.1 / 0 |
| CPU-bound standalone            |     2 |                     199 / 0 |          200 / 0 |          200 / 0 |
| CPU-bound standalone            |   2.5 |                     199 / 0 |          200 / 0 |          200 / 0 |
| CPU-bound standalone            |    10 |                     198 / 0 |          200 / 0 |          200 / 0 |
| CPU callee, one connection      |  1.01 |                     399 / 0 |       398.95 / 0 |       398.95 / 0 |
| CPU callee, one connection      |   1.1 |                     399 / 0 |        399.3 / 0 |        399.3 / 0 |
| CPU callee, one connection      |     2 |                     399 / 0 |          400 / 0 |          400 / 0 |
| CPU callee, one connection      |   2.5 |                     399 / 0 |          400 / 0 |          400 / 0 |
| CPU callee, one connection      |    10 |                     397 / 0 |          400 / 0 |          400 / 0 |
| CPU-design fixture, no pool     |  1.01 |                     570 / 0 |       569.64 / 0 |       569.64 / 0 |
| CPU-design fixture, no pool     |   1.1 |                     570 / 0 |        664.4 / 0 |    **569.8 / 0** |
| CPU-design fixture, no pool     |     2 |                     498 / 0 |          498 / 0 |          498 / 0 |
| CPU-design fixture, no pool     |   2.5 |                     498 / 0 |        497.5 / 0 |        497.5 / 0 |
| CPU-design fixture, no pool     |    10 |                     496 / 0 |          500 / 0 |          500 / 0 |
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
| Fragmentation                   |    10 |                     995 / 0 |         1000 / 0 |         1000 / 0 |

## Correction to the approved rule

The CPU design let every tail yield, including tails of whole requests. Measured, that rule moved three free-play goldens away from scale one, all at scale 10: `blocking-call`, `scale-on-busy-threads` and `corpus-w1-busy-threads`. The yield rule now applies only to fractional tails, and no golden changes.

Method: each free play was replayed through the engine with its source's per-tick arrivals prescribed. This reproduces the committed goldens exactly, field for field. The reference is scale one fed 10 real requests at each dot's instant (`sameArrivals`); it is identical on master and the branch. In-system dots compare like for like: the engine counts messages, so a scale-ten dot and a scale-one request each count once, and the reference is divided by 10. The tracer's latency summaries are not comparable, because its 160-journey history keeps 34 journeys at scale one against 221 at scale 10.

| `blocking-call` free play, 60 s (deterministic) | Master | Every tail yields | Scale-one reference |
| ----------------------------------------------- | -----: | ----------------: | ------------------: |
| Real caller completions                         | 13,710 |            14,170 |              11,854 |
| In system (dots)                                |  1,039 |               994 |             1,222.6 |
| Applications backlog (real)                     |  9,530 |             9,070 |              11,401 |
| Mean caller CPU phase per request (ms)          |   39.5 |              30.0 |                81.6 |

Sampled `blocking-call` was already 15.7% too fast. It has 64 threads, or 6.4 dots, so one dot in seven holds a thread of weight 4 and leaves a 6-request tail. At scale one, a replica's 16 threads start together and share one core: each request's first CPU phase takes 81.6 ms. A sampled dot's CPU is spread over all four replicas, so its phase takes 30 to 40 ms. On master, that whole-request tail took its share ahead of first waves, which is closer to real contention. Making it yield removed that, and the error grew to 19.5%. The result is the same for all 12 seeds tried; the diagram has no jitter. The busy-thread pair moves by one or two dots of about a thousand at seed 7. Over 12 seeds the mean change is +7.5 real completions (5 seeds away, 7 closer), which is jitter noise in either direction.

Across 343 generated scenarios at scale > 1, the two rules agree exactly at fractional scales. There, 55 of 143 pass, as on master, and the total error falls from 21,242 to 21,171. At whole-dot scales, whole-request tails yielding gains 2 passes of 200, but the total error rises from 64,892 to 64,974, with 14 scenarios better and 14 worse. The fractional-only rule matches master exactly there. The deeper cause, a dot's CPU spread over every replica while scale one packs requests onto partly filled replicas, is in [the CPU placement follow-up](../backlog/2026-10-21-sampled-cpu-placement.md).

A first implementation shared the yield phase in tail order, which can leave budget unused while a tail is still short. The fixed 40-sample I1 corpus caught that as "owed CPU grew without an exhausted budget". The phase now water-fills per key. The fixed corpus passes 16 of 31.
