## Cache core (1/6)

The `p3-w3` model adds derived TTL caching to CDN and cache stencils, including inherited aliases. GET and HEAD Requests can hit a fresh item or wait for an origin fetch; successful replies fill the cache, while failures, timeouts, no-store policies, other methods and Messages never fill it. Cache stores can forward read-through misses. New diagrams use W3; existing diagrams keep their revision and can upgrade explicitly, with Undo. Legacy export strips cache rules.

The runtime loads separately before a caching Live session starts. Runs start warm at their planned initial rates; direct engine users without rates start cold. Analysis reports cache-served route demand and reduced origin traffic. Item tracking, independent random streams and checkpoints preserve deterministic replay at every scale. Diagrams without cache rules retain their existing behavior.

Coalescing, stale responses, purges, cache-aside, cache controls and Live readouts are reserved for later PRs. Unsupported policies are rejected rather than silently ignored. No bundle budget or reserve is raised.

Six new `w3-*` parity fixtures cover warm TTL behavior, methods/no-store, routing, read-through stores, scales 1/2/10, and pooled deadlines. Their new goldens record simulation, planning, agent, export and rendering outputs. Existing per-diagram goldens must remain unchanged. Shared schema, validation inventory and English-catalog records necessarily gain W3's contract and messages, as listed in the approved design; the final verification records their exact diff.
