## Partial-dot reporting precision predates caching

The property in `src/sim/partialDots.test.ts` can fail even though its tick-by-tick execution checks agree. The final snapshot rounds counters to nine decimal places in dots, then `realSnapshot` multiplies by scale. Near a six-decimal request boundary that intermediate rounding changes the reported result.

A seed sweep found this counterexample independently of Nightly's lost failure details:

```text
FC_SEED=-2078140383
FC_RUN_MULTIPLIER=20
path=154:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:19:0:1:1:0:0:1:1:0:0:0:1:1:0:1:2:0:4:1:0:1:0:3:0:0
```

Replay with `pnpm exec vitest run src/sim/partialDots.test.ts --maxWorkers=1`, setting the two environment variables above and `CI=true`. The property fails after 155 generated cases and 44 shrinks, with scale 10, `t=1.8353726362226697e-8`, no forced failures and burst 1. The reduced graph has two zero-latency one-thread services, a blocking call with pool 1 and 10 ms travel/network delay, and an output to a store. Three injections represent `3 * (1.01 + t * 8.99)` requests. The native snapshot's dot rounding leads to `3.030001` versus `3.03` in final node and edge totals.

The same seed, shrink path and mismatch reproduce on `11839fab2` before caching and on two fresh invocations against each clean `origin/master` source archive: `641c94ec5` at the start, then `e4a332cf7` after the final fetch. This is not a cache-runtime state divergence. The replay logs are under the ignored `tests/.output/compare/` directory in the investigation worktree. No other worktree was used.

Nightly run `41792146002`, job `126447748257`, printed the failing property at 10.263 s, then hit its twenty-minute step limit while the cache agreement suite was still running. It produced no property-results artifact or original seed/path. The discovered seed above must not be represented as the original Nightly seed. Same-seed 800-case passing controls took about 11.4 seconds both before and after caching; they did not establish a new partial-dot runtime regression.

Resolve this with a reporting/precision contract that preserves the strict allocation-accuracy and historical fractional-scale checks. Globally rounding in requests, or retaining raw counters and normalizing every real counter, changes those exact contracts; neither prototype is retained. Do not raise a tolerance, change a pinned expected outcome, quarantine the property or re-record unrelated goldens to hide this failure. Also retain per-test failure details before a long property shard can be terminated.
