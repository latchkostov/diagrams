## Cache core (1/6)

The `p3-w3` model adds derived TTL caching to CDN and cache stencils, including inherited aliases. GET and HEAD Requests can hit a fresh item or wait for an origin fetch; successful replies fill the cache, while failures, timeouts, no-store policies, other methods and Messages never fill it. Cache stores can forward read-through misses. New diagrams use W3; existing diagrams keep their revision and can upgrade explicitly, with Undo. Legacy export strips cache rules.

The runtime loads separately before a caching Live session starts. Runs start warm at their planned initial rates; direct engine users without rates start cold. Analysis reports cache-served route demand and reduced origin traffic. Item tracking, independent random streams and checkpoints preserve deterministic replay at every scale. Diagrams without cache rules retain their existing behavior.

Coalescing, stale responses, purges, cache-aside, cache controls and Live readouts are reserved for later PRs. Unsupported policies are rejected rather than silently ignored. No bundle budget or reserve is raised.

Six new `w3-*` parity fixtures cover warm TTL behavior, methods/no-store, routing, read-through stores, scales 1/2/10, and pooled deadlines. Their new goldens record simulation (including cache counters), planning, agent, export and layout outputs. Existing per-diagram goldens remain unchanged. Shared schema, validation inventory and English-catalog records gain W3's contract and messages, as listed in the approved design.

## Shared golden changes

- `node/agent/tools.json`: the public tools accept cache props and the W3 revision.
- `node/skill/public-schemas.json` and `node/skill/corpus-hand-shaped-lines.public-schemas.json`: schema hashes and byte counts include the same contract additions.
- `node/skill/files.json` and `node/skill/corpus-hand-shaped-lines.files.json`: generated reference hashes include the cache property and its bounds.
- `node/skill/validate.txt`: the validation inventory includes the six new W3 fixtures.
- `node/i18n/catalogs.json`: eight English messages cover model upgrade, simulation context names, dormant rules and legacy export; other languages use the existing English fallback.

No existing diagram's simulation, planning, checks, trace, exports, layout or browser golden changes.

## Accuracy and bundle evidence

At 1,000 requests/s over 1,000 Typical items with a five-second TTL, analysis predicts 84.431% hits. Across seeds 1, 7, 17, 42 and 99, steady-state Live records 83.775–84.600% at scale one (maximum difference 0.657 percentage points; fetch-rate error at most 4.215%). At scale ten the maximum difference is 1.532 points, within its three-point bound.

The cache runtime measures 1,920 B gzip. Live's static closure beyond the canvas measures 123,861 B gzip: 11,139 B below its unchanged limit and 4,995 B below its unchanged reserve. The W3 cache benchmark passes the existing 8× input / 24× growth gate.

Cache schema constants share the existing native model initialization group. A production-build regression prevents a lazy authoring chunk from seeing an uninitialized cache schema.

Restarting Free play warms the cache from the current Inputs, including Traffic ×, rather than the diagram's base rate.

The randomized agreement gate uses five seeded batches, preserving all cases and simulation windows at Nightly's 20× multiplier without placing 100 simulations under one test-runner timeout.
