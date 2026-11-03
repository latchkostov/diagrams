## Cache agreement review fixes (#431, round 1)

Capacity checks keep plain stores unlimited when an unrelated busy-thread autoscaler triggers a second analysis. All check analyses now use the planning policy, including explicit ready-replica fleets.

Statistical cache hits expire after the last successful fill's TTL, even when an origin pauses indefinitely without a deadline. Arrivals cannot extend that deadline. Short-TTL rules use stratified statistical outcomes with at most one dot of carried credit, avoiding a second expiry penalty from gaps between sampled fills. The successful-fill deadline still gates every hit. The carried credit is included in checkpoints.

Short-TTL rules share one tracking-eligibility predicate between playback and automatic scale selection. The 2,000 requests/s, 20 Even items, 100 ms TTL configuration retains scale 50 instead of dropping to 1 without tracking any items.

The cache hover summary puts both hit and origin-offload percentages first, followed by a short recent-window scope. Expanded details retain the fuller explanation. Cache latency identifies its actual measurement boundary: since restart, or since the last effective drill fault at its simulation time, including immediately after the reset before samples arrive.

Golden change: `node/i18n/catalogs.json` adds the compact-summary and fault-scope English messages and their fallback counts in each locale. No translation is stamped or mechanically changed. No per-diagram golden changes are intended in this fix round.

Each review finding has a regression verified by temporarily reverting its fix. The short-TTL agreement regression also fails without stratification. Agreement tolerances and test budgets remain unchanged.
