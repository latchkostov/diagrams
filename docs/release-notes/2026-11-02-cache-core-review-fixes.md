## Cache core review fixes (#427, round 1)

Saved setup and timeline cache overrides now participate in edit validation. Changing their node to a
stencil that cannot cache is refused before autosave, so the last accepted document still reloads.

Cold statistical caches cannot answer without a successful fetch. Warm statistical freshness expires
after the TTL without another successful fetch. The pinned nested-retry regression consequently has
26 unfinished requests at its intermediate checkpoint instead of four: failed fetches no longer
invent successful hits that terminate retries. Its finite recovery bound must still drain everything.

Capacity planning resolves each traffic class's eligible origins before computing fetch latency,
then weights those contributions by admitted demand for each cache rule. Origin properties use an
edge-ID index outside the fixed-point loop. The new agreement case routes to 20 ms and 1,510 ms
origins and retains the existing hit-ratio and fetch-rate tolerances.

Read-through stores activated by setup or timeline patches initialize the same retry, breaker,
outcome-classification and target-reservation capabilities as stores configured at load.

Simulation authoring can calculate scale before the playback runtime loads. Sampling uses peak
demand and ignores unused rules; warm starts continue to use initial demand. Playback remains lazy.

The checkpoint regression now covers 256 compiled rules and all 4,096 tracked items. Immutable
configuration and untouched initial rings/counters are shared; the first write detaches mutable
state. The existing 130 KiB checkpoint bound and all bundle budgets stay fixed.

All eight regressions were mutation-checked. No parity golden was updated.

## Agreement and bundle measurements

Over seeds 1, 7, 17, 42 and 99, the routed rules predict 85.017% hits for the fast origin
and 67.599% for the slow origin. The largest hit-ratio error is 0.553 percentage points at
scale 1 and 1.702 points at scale 10. Scale-one fetch-rate error stays within 3.687%.

The cache runtime is 1,991 bytes gzip. Live is 124,393 bytes gzip: 10,607 bytes below its
135,000-byte budget and 4,463 bytes below the unchanged reserve. Startup is 161,701 bytes
and the canvas first view is 366,878 bytes. All bundle and reserve gates pass.
