## Sampling accuracy: the throttle split

A concurrency throttle with room for w < N real requests no longer stretches a sampled dot. It admits a partial dot of w at full weight and refuses a sibling partial dot of N − w at the same instant, as scale 1 admits w members of a burst and throttles the rest. Every admission limit splits: a node or endpoint `maxInFlight`, a shared allocation, and a managed node's slots (a Lambda's `maxConcurrency`, owner decision 2026-10-22). A dot that fits is never split, since packing it would refuse requests an idle throttle admits. The admitted part spends quota; the refused part spends none, as at scale 1, and token-bucket quotas still check the whole dot. A shortfall in execution slots still queues the dot (stretch).

The sibling goes through the ordinary rejection path (counted rejected with its reason, acknowledged, answered, its journey ended). It holds no delivery of its own, and it leaves the broker's counters when refused. A redelivered admitted part keeps its size; it used to be rebuilt as a whole dot. A dot a caller awaits is not split, since a call settles on one reply, and neither is a retried attempt or one whose CPU is already sized. All three keep the stretched grant ([backlog](../backlog/2026-10-22-sampling-managed-admission-bursts.md)). `throttleSplit` in `admission.ts` is the shared rule that queue-limit shedding and half-open probes will reuse.

## Settlement before arrivals

Each tick now settles every node's due releases before admitting the tick's arrivals, so a node that admits on arrival sees the capacity its cohorts turned over. At scale 1 nothing is ever due, so no scale-one result moves. No golden moves on top of 8a-pre.

## Known gaps

- **Managed admission at 2.5** is accepted (owner decision): 399 / 1,597.5 against 599 / 1,398 at scale 1 (master 500 / 1,497.5). Scale 1 alternates bursts of two and three; every dot is 2.5.
- **Two callers sharing one slot** (corpus index 12, at 1.5) divide it 24 / 33 against 28 / 29, with the total exact. Scale 1 itself swings from 39 / 18 to 9 / 49 between 90 and 95 requests/s.

## Message volume

Each split adds one sibling message. In the fully throttled accuracy fixtures that is one sibling per admitted dot: +50% messages at 1.01 (each sibling carrying a hundredth of a request), +100% at 2 to 10, and two per dot for managed admission at 10, whose queue already delivers each dot in parts. No example simulation splits.

## Accuracy comparison

Measured with `src/test/scaleEquivalence.ts`: seed 7, 100 real requests/s, 20 seconds; master 4877f5dce3595a83af56043f726fb1f929fedd87. C / R means real caller completions / rejections. The fixed 40-sample I1 corpus passes 17/31: index 0 now passes and index 12 newly fails (above); index 8 already passes after 8a-pre.

| Fixture                         | Scale | Same-arrivals scale 1 C / R |     Master C / R |     8a-pre C / R |      8a C / R | Direction (from master)       |
| ------------------------------- | ----: | --------------------------: | ---------------: | ---------------: | ------------: | ----------------------------- |
| Managed zero-work, zero network |  1.01 |                  990 / 1009 | 669.63 / 1329.16 | 669.63 / 1329.16 |  990 / 1009.8 | closer                        |
| Managed zero-work, zero network |   1.1 |                  909 / 1090 |   699.6 / 1299.1 |   699.6 / 1299.1 |  909 / 1090.8 | closer                        |
| Managed zero-work, zero network |     2 |                  999 / 1000 |      1000 / 1000 |      1000 / 1000 |    999 / 1000 | closer                        |
| Managed zero-work, zero network |   2.5 |                  799 / 1200 |      1000 / 1000 |      1000 / 1000 |    799 / 1200 | closer                        |
| Managed zero-work, zero network |    10 |                  199 / 1800 |      1000 / 1000 |      1000 / 1000 |    199 / 1800 | closer                        |
| CPU-bound standalone            |  1.01 |                     199 / 0 |       189.88 / 0 |       189.88 / 0 |    189.88 / 0 | same                          |
| CPU-bound standalone            |   1.1 |                     199 / 0 |        199.1 / 0 |        199.1 / 0 |     199.1 / 0 | same                          |
| CPU-bound standalone            |     2 |                     199 / 0 |          200 / 0 |          199 / 0 |       199 / 0 | closer                        |
| CPU-bound standalone            |   2.5 |                     199 / 0 |          200 / 0 |          200 / 0 |       200 / 0 | same                          |
| CPU-bound standalone            |    10 |                     198 / 0 |          200 / 0 |          198 / 0 |       198 / 0 | closer                        |
| CPU callee, one connection      |  1.01 |                     399 / 0 |       398.95 / 0 |       398.95 / 0 |    398.95 / 0 | same                          |
| CPU callee, one connection      |   1.1 |                     399 / 0 |        399.3 / 0 |        399.3 / 0 |     399.3 / 0 | same                          |
| CPU callee, one connection      |     2 |                     399 / 0 |          400 / 0 |          400 / 0 |       400 / 0 | same                          |
| CPU callee, one connection      |   2.5 |                     399 / 0 |          400 / 0 |          400 / 0 |       400 / 0 | same                          |
| CPU callee, one connection      |    10 |                     397 / 0 |          400 / 0 |          400 / 0 |       400 / 0 | same                          |
| CPU-design fixture, no pool     |  1.01 |                     570 / 0 |       569.64 / 0 |       569.64 / 0 |    569.64 / 0 | same                          |
| CPU-design fixture, no pool     |   1.1 |                     570 / 0 |        569.8 / 0 |        569.8 / 0 |     569.8 / 0 | same                          |
| CPU-design fixture, no pool     |     2 |                     498 / 0 |          498 / 0 |          498 / 0 |       498 / 0 | same                          |
| CPU-design fixture, no pool     |   2.5 |                     498 / 0 |        497.5 / 0 |        497.5 / 0 |     497.5 / 0 | same                          |
| CPU-design fixture, no pool     |    10 |                     496 / 0 |          500 / 0 |          500 / 0 |       500 / 0 | same                          |
| Legacy queue worker             |  1.01 |                    1997 / 0 |      1996.77 / 0 |      1996.77 / 0 |   1996.77 / 0 | same                          |
| Legacy queue worker             |   1.1 |                    1997 / 0 |       1996.5 / 0 |       1996.5 / 0 |    1996.5 / 0 | same                          |
| Legacy queue worker             |     2 |                    1997 / 0 |         1998 / 0 |         1998 / 0 |      1998 / 0 | same                          |
| Legacy queue worker             |   2.5 |                    1996 / 0 |       1997.5 / 0 |       1997.5 / 0 |    1997.5 / 0 | same                          |
| Legacy queue worker             |    10 |                    1989 / 0 |         1990 / 0 |         1989 / 0 |      1989 / 0 | closer                        |
| Sub-tick work                   |  1.01 |                     499 / 0 |       498.94 / 0 |       498.94 / 0 |    498.94 / 0 | same                          |
| Sub-tick work                   |   1.1 |                     499 / 0 |        499.4 / 0 |        499.4 / 0 |     499.4 / 0 | same                          |
| Sub-tick work                   |     2 |                     499 / 0 |          500 / 0 |          500 / 0 |       500 / 0 | same                          |
| Sub-tick work                   |   2.5 |                     499 / 0 |          500 / 0 |          500 / 0 |       500 / 0 | same                          |
| Sub-tick work                   |    10 |                     497 / 0 |          500 / 0 |          500 / 0 |       500 / 0 | same                          |
| Lambda join                     |  1.01 |                  494 / 1503 | 398.95 / 1598.83 | 398.95 / 1598.83 | 494 / 1503.79 | closer                        |
| Lambda join                     |   1.1 |                  484 / 1513 |   399.3 / 1598.3 |   399.3 / 1598.3 |  484 / 1513.7 | closer                        |
| Lambda join                     |     2 |                  499 / 1498 |       500 / 1498 |       500 / 1498 |    499 / 1498 | closer                        |
| Lambda join                     |   2.5 |                  399 / 1597 |     500 / 1497.5 |     500 / 1497.5 |  399 / 1597.5 | closer                        |
| Lambda join                     |    10 |                  398 / 1592 |       500 / 1490 |       465 / 1525 |    398 / 1592 | closer                        |
| Fragmentation                   |  1.01 |                     999 / 0 |       998.89 / 0 |       998.89 / 0 |    998.89 / 0 | same                          |
| Fragmentation                   |   1.1 |                     999 / 0 |        998.8 / 0 |        998.8 / 0 |     998.8 / 0 | same                          |
| Fragmentation                   |     2 |                     999 / 0 |         1000 / 0 |         1000 / 0 |      1000 / 0 | same                          |
| Fragmentation                   |   2.5 |                     998 / 0 |         1000 / 0 |         1000 / 0 |      1000 / 0 | same                          |
| Fragmentation                   |    10 |                     995 / 0 |         1000 / 0 |         1000 / 0 |      1000 / 0 | same                          |
| Managed admission (siblings)    |  1.01 |                  662 / 1335 | 399.96 / 1598.83 | 399.96 / 1598.83 | 662 / 1335.79 | closer                        |
| Managed admission (siblings)    |   1.1 |                  635 / 1362 |   399.3 / 1598.3 |   399.3 / 1598.3 |  635 / 1362.7 | closer                        |
| Managed admission (siblings)    |     2 |                  499 / 1498 |       500 / 1498 |       500 / 1498 |    499 / 1498 | closer                        |
| Managed admission (siblings)    |   2.5 |                  599 / 1398 |     500 / 1497.5 |     500 / 1497.5 |  399 / 1597.5 | **away** (accepted known gap) |
| Managed admission (siblings)    |    10 |                  398 / 1592 |       500 / 1490 |       597 / 1393 |    398 / 1592 | closer                        |
