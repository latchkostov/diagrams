## Sampling accuracy: one allocation weight

The ledger, caller occupancy and partial admission now use the approved allocationWeight rule. It divides capacity among cohorts when a maximal allocation would strand less than one real request. Two slots at scale 1.1 now grant two weight-one cohorts instead of one weight-1.1 cohort. Fragmentation completes 998.8 real requests versus 878.9 previously, against the same-arrivals scale-one reference of 999. The minimum min(1, N), cohort(work), thread-acquisition work segments and release quantization stay intact.

## Accuracy comparison

Measured with src/test/scaleEquivalence.ts, seed 7, 100 real requests/s, 20 seconds; master 61957d3a66db575f38e85589ab4a24c37409b025. C / R means real caller completions / rejections, rounded here to two decimals. Every required row is unchanged or closer to its same-arrivals reference; a separate all-node comparison also found no completion/rejection regression. Existing residual gaps remain for later sampling PRs.

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
| CPU callee, one connection      |  1.01 |                     399 / 0 |       336.33 / 0 |       398.95 / 0 |
| CPU callee, one connection      |   1.1 |                     399 / 0 |        366.3 / 0 |        399.3 / 0 |
| CPU callee, one connection      |     2 |                     399 / 0 |          286 / 0 |          286 / 0 |
| CPU callee, one connection      |   2.5 |                     399 / 0 |          285 / 0 |          285 / 0 |
| CPU callee, one connection      |    10 |                     397 / 0 |          180 / 0 |          180 / 0 |
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
| Fragmentation                   |  1.01 |                     999 / 0 |       806.99 / 0 |       998.89 / 0 |
| Fragmentation                   |   1.1 |                     999 / 0 |        878.9 / 0 |        998.8 / 0 |
| Fragmentation                   |     2 |                     999 / 0 |         1000 / 0 |         1000 / 0 |
| Fragmentation                   |   2.5 |                     998 / 0 |         1000 / 0 |         1000 / 0 |
| Fragmentation                   |    10 |                     995 / 0 |          580 / 0 |          580 / 0 |

## Approved re-pins and regression coverage

Q3 fractional schedules (1.01, 1.1, 1.5 and nested pause) now admit two cohorts at 10 ms. Non-nested final completion moves from 20,040 ms to 10,240 / 12,120 / 16,470 ms respectively; nested completion stays 1,780 ms. The paused-shrink fixture starts with three slots so it still returns an unused half slot while retaining 1.5 request residence.

Fragmentation is an ordinary I1 regression at scales 1.1, 1.3 and 1.5. Its exact unit snapshot is re-pinned (caller/partner 878.9 to 998.8; result 878.9 to 997.7). The CPU-without-pool unit pin becomes 664.4 caller/partner and 663.3 result, previously 366.3 / 366.3 / 365.2, closer to the 570 reference but still a named expected failure for PR 6. These unit pins are separate from output parity. Both parity tiers passed: 2,869 goldens, zero changed, added, missing or stale. No parity golden was re-recorded.

Standalone retries without an outage now have CPU-retention coverage, including scale edits to 1 and 20 during backoff. Each failed-plus-successful ten-member cohort charges 2,000 CPU-ms and drains every reservation and CPU-part owner. Removing CPU carry makes all three cases fail at 1,100 CPU-ms. Restoring old allocation call sites makes packing, fractional schedules and fragmentation checks fail; scale 1.5 already fit within the old I1 bound, so exact allocation rows protect its packing.

The fixed generated I1 corpus improves to 16/31 (required floor 13/31). The refreshed skill ZIP is 834,024 bytes; no skill prose or budget was trimmed.
