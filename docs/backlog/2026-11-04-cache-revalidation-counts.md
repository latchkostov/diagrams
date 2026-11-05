## Statistical misses can also increment the revalidation diagnostic

P2 follow-up found while verifying #435 round one. This is independent of the
reviewed allocation bound: actual fetch counts and represented origin traffic
remain correct, but the optional `revalidations` diagnostic can overcount.

`CacheLookup.revalidate` carries dispatch credit even when that statistical
lookup's outcome is `miss`. After dispatching its separate background work, the
engine forwards the original miss with that flag still present.
`cacheRuntime.start` currently counts any truthy flag as revalidation work, so
it also labels the original miss cohort as revalidations.

A deterministic runtime reproduction uses seed 0, scale 1,000,000, an Even rule
with 1,000,000 items, a 1,000 ms freshness interval, a 1,000 ms stale window,
planned demand 1,000,000 requests/s and a 5,000 ms fetch. At 100 ms, lookup of a
1,000,000-unit cohort is a miss and carries 87,808 units of refresh credit.
Starting only that original miss records 1,000,000 fetches and 1,000,000
revalidations; it should record zero revalidations until background work starts.
This assertion fails on the round-one head before any proposed fix.

Follow up by separating refresh dispatch credit from the started work's kind,
or by restricting the diagnostic increment to actual background refresh work.
Add conservation coverage where one statistical arrival both misses and
accumulates refresh credit, including checkpoint replay and weighted batches.
Review affected stale-simulation goldens explicitly; preserve every workload,
agreement bound, call limit, reserve and checkpoint bound. No runtime change or
golden update is included merely to absorb this separate counter issue.
