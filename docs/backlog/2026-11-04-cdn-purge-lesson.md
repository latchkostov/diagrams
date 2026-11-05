## CDN PR 4: hard-purge lesson corrected by the owner

Resolved by the orchestrator's 2026-11-04 decision: preserve the model, four-thread
origin, 20,000-product working set, 40-second run and every chip threshold.
Refilling the cold tail takes minutes. Hard purge leaves the origin far behind
through the run; backlog and shopper p95 fail. Soft purge serves stale copies
while refreshing, and every chip passes. The example description, narration,
run-end lesson and five-seed regression now say this.

The design's §6.2 table incorrectly promised recovery after a few seconds. The PR
body must call out this correction. No origin capacity or thresholds were changed.

`itemFetches` has no item selector. Its unchanged maximum-over-tracked-items
metric is now labelled “Most fetches in flight for one item < 5, always”.
TTL-only still fails all chips and One fetch per item still passes all chips.
Hard purge's third chip passes for seed 1 and fails for seeds 7, 17, 42 and 99;
these unrelated product fetches must not be hidden behind a launch-page label.

Measured hard-purge end backlogs: 808, 825, 798, 816 and 807; shopper p95 is
2,050 ms in every seed. Soft purge peaks at backlogs 11, 12, 16, 18 and 16,
drains by the end, and ends at p95 258.04 ms. All five soft-purge runs pass.

Temporarily restoring the pre-correction example and run-end implementation
makes all six regression tests fail; restoring the fixes passes them.

Before feature edits, Black Friday `planScaling` measured 965.6 ms cold and
723.7, 672.8 and 678.5 ms warm without memoization. Each call played four stories,
11,248 ticks and 25,218 messages. The final after measurement and the rejected Black Friday mix are recorded in
the release and design-review fragments. The accepted Black Friday mix passes
every chip across the same five seeds.
