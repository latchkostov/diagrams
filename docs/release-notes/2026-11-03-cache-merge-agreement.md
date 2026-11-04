## Expected/Live agreement with coalesced fills

Merge master into the cache-agreement branch, preserving cache-owned single-request fetches, whole-dot waiters, leader failures, waiter deadlines, and herd observations alongside planned fetch latency, fill-bounded statistical freshness, window-only ratio reads, and explicit latency scopes. Coalesced replies fill a tracked expiry once. Statistical progress becomes overdue only after the expected fetch time; arrivals do not extend it, and failed fills cannot renew freshness.

Short-TTL rules that Live makes statistical now use the same tracking eligibility in planning. They neither predict coalesced origin traffic nor consume tracking slots needed by later rules. The regression initially predicted a 0.3115% fetch share against Live's 37.6947% statistical share; the shared formula now agrees. New checks cover the shared 4,096-item budget and fresh-hit agreement with coalescing at scales 1 and 10, including fetches longer than the TTL. Agreement tolerances and checkpoint bounds remain unchanged.

The paired summary and latency messages use selectors to retain identical compact/full and restart/fault wording without duplicate keys. This keeps the combined locale catalogs within their existing budgets: Arabic core is 37,999 bytes against 38,000. No chrome or controls are added.

## Regenerated output parity

Seven Black Friday records combine the revised qualitative doors-open narration with master's added doorbuster-stampede simulation:

- `node/agent/describe/black-friday-commerce.json`: the JSON timeline retains the revised note; textual and focused descriptions include the additional simulation.
- `node/agent/edit/black-friday-commerce.json`: the edited diagram retains both the revised note and additional simulation.
- `node/exports/native/black-friday-commerce.diagram.json`: the native diagram carries both changes.
- `node/exports/drawio/black-friday-commerce.drawio`: embedded diagram data carries both changes.
- `node/exports/drawio-meta/black-friday-commerce.json`: read-back data, XML byte count, and XML fingerprint follow the combined diagram.
- `node/exports/html/black-friday-commerce.light.json`: the Interactive HTML payload, byte count, and fingerprint follow the combined diagram.
- `node/skill/scripts/black-friday-commerce.json`: share-link byte count/fingerprint and exported HTML payload follow the combined diagram.

`node/i18n/catalogs.json`: cache-area fingerprints and message/fallback counts combine both PRs' messages and the consolidated selectors; the examples area retains the stampede gallery message.

The additional `node/planning/cache-stampede.json` records the planned 20 ms database response retained by the agreement fix. Origin thread hold becomes 80 ms rather than 60 ms, capacity becomes 50 rather than 66.67 requests/s, and free-play origin demand becomes 39.0303 rather than 37.8365 requests/s. Free-play utilization becomes 78.0606% rather than 56.7547%; coalesced demand becomes 27.3225 rather than 27.3206 requests/s, and utilization becomes 54.6450% rather than 40.9809%. Dependent utilization tones, headroom copy, route contributions, and resolved CDN/database response times follow those inputs.

The stampede lesson still holds: average planning demand stays below the corrected capacity, while synchronized expiry overloads the four-thread origin in Live. Seeds 1, 7, 17, 42 and 99 retain the unchanged bands: the first TTL-only herd has 60–74 fetches, later herds exceed twice that first peak, backlog exceeds 1,000 and p95 exceeds one second, with all three chips failing. Coalescing keeps at most one launch-item fetch and backlog below 10, with every chip passing, including p95 below 300 ms. All three stampede simulation goldens remain byte-identical to master.

Every golden is regenerated rather than hand-merged. No browser drawing changes are intended.
