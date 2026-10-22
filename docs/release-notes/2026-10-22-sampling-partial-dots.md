## Sampling accuracy: partial-dot plumbing

A partial dot is part of a sampled dot split at one instant: some of its requests admitted and the rest refused, kept and shed, or retried apart. It carries its own represented size `r`, where a whole dot carries the scale `N`. Nothing splits a dot yet. This release lays the plumbing that the throttle split, pooled-deadline cohorts and the resilience kit's queue-limit shedding and jitter splits will use. Every scale-one and sampled result is unchanged.

There is one represented size. `representedOf(m)` sizes admission, threads, pools, CPU, residence, request quotas and request-rate arrivals. `cohort(work)` is that size fixed once capacity or CPU is sized, so a live scale edit never resizes it. Every counter adds `r / N` dots: processed, failed, dropped, outage drops, blocked, rejected (with reasons and route refusals), dead-lettered, deliveries, route counts and the call counters. A split's parts therefore always sum to their dot. Width is not a size: it only caps the weight a cohort is granted. Reports round counters to 1e-9 dots, so tenths of a dot add up exactly. Queue depths, lag and in-system counts still count messages, and latency samples are unweighted.

Loss callbacks (`onLoss`) carry each loss's `dots`, and the evidence check adds those, so mixed whole and partial losses aggregate exactly. `measure()` reads counters at 1e-9 dots too, so a saved expectation of exactly 10 meets ten partial dots of one. A blocking call releases the held-call gauge by the dots it charged, so a live scale edit leaves no residue.

Two admission gates now read the next cohort's size instead of assuming a whole dot. Admission needs room for at least `min(1, r)`, which `SampledLedger.reserve` already applied, so a dot under one request no longer waits for a whole free slot. A network device's ceiling charges each dot `r / N` of a dot's credit. Calls in flight count a pool lease's share of its cohort at the cohort's own size, and a new ledger oracle checks that they match the live pool leases.

## I7: a continuation's takeover carries capacity, not CPU

A continuation that took over its own retained thread used to absorb the cohort's unfinished tail CPU as backlog behind its own first wave. When the hold had already expired, or with the I7 probe's immediate holds, the same CPU stayed a separate whole-request tail and kept its fair share. So whether a hold outlived the reply decided when the continuation finished. The scale-4 counterexample (seed 1235471473) settled at 110 ms with holds and 120 ms without. The continuation still takes over the thread and its physical ownership, so it stays on the same replica ranges and drain deadlines, and termination grace still applies after a scale-in. But CPU the tail has not run now stays a tail on those ranges, classified once, as before, and the continuation's reply CPU goes on its own share of them. Only past the CPU part budget does the old merge apply. It moved no golden and no accuracy row. A continuation whose hold has already expired still re-allocates on ready replicas, as on master; that is in the [backlog](../backlog/2026-10-22-continuation-ownership-after-hold.md).

## Accuracy comparison

Measured with `src/test/scaleEquivalence.ts`: seed 7, 100 real requests/s, 20 seconds; master e347bd030efa4a380d6531d2d58a38ad8a38b635. C / R means real caller completions / rejections, rounded here to two decimals. Every row is identical to master.

| Fixture                         | Scale | Same-arrivals scale 1 C / R |     Master C / R |     Branch C / R |
| ------------------------------- | ----: | --------------------------: | ---------------: | ---------------: |
| Managed zero-work, zero network |  1.01 |                  990 / 1009 | 669.63 / 1329.16 | 669.63 / 1329.16 |
| Managed zero-work, zero network |   1.1 |                  909 / 1090 |   699.6 / 1299.1 |   699.6 / 1299.1 |
| Managed zero-work, zero network |     2 |                  999 / 1000 |      1000 / 1000 |      1000 / 1000 |
| Managed zero-work, zero network |   2.5 |                  799 / 1200 |      1000 / 1000 |      1000 / 1000 |
| Managed zero-work, zero network |    10 |                  199 / 1800 |      1000 / 1000 |      1000 / 1000 |
| CPU-bound standalone            |  1.01 |                     199 / 0 |       189.88 / 0 |       189.88 / 0 |
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
| CPU-design fixture, no pool     |   1.1 |                     570 / 0 |        569.8 / 0 |        569.8 / 0 |
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
