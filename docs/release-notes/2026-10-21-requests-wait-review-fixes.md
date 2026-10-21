## Requests that wait: review fixes

KEDA now tracks whether the winning recommendation came from resources, Pods or a broker. A busy-thread winner keeps its 8-pod recommendation and busy-thread explanation; broker partition caps, raw backlog arithmetic and fallback reasons apply only to broker winners. This provenance is internal, preserving the public explanation contract.

Every newly initialized resource fleet receives the configured Concurrency. Equivalent traffic at scales 1 and 2 (four pods, Concurrency 16, forty held requests) now reports 61.875% busy threads and keeps four pods instead of reporting 990% and growing to eight.

Fractional thread admission carries its exact active time into connection-pool acquisition. Due request and pool reservations release before a successor thread is admitted. The original zero-work, one-connection throughput regression is restored to a passing test with its unchanged assertion: 999 completions at scale 1, 997.88 at scale 1.01, and 997.5 at scale 2.5. Feeding the scale-one reference at the sampled arrival instants also gives 999; that comparison rule does not account for the previous 798.91 result.

Live's Why details use busy-thread units without requiring a cloud adapter. Regressions cover both target units and prove non-blocking waits, including calls queued behind a capped pool, publish zero busy-thread pressure and retain the minimum fleet.

The review's separate KEDA resource-target controls and CPU-limited static sizing estimate are queued in `docs/backlog/2026-10-21-requests-wait-review-p-two.md`. Existing pooled-deadline sampling pins remain unchanged. No test bound is relaxed and no new expected failure is introduced.

## Verification and output parity

Deliberately reverting the fixes fails nine regressions, including the original 798.91 throughput result; restoring them passes. Existing public explanation fields remain unchanged by the internal winning-source discriminator. Output parity and final gate results are recorded in the PR.

The corrected fleet metric affects only five records introduced by this PR (all are additions relative to origin/master):

- `node/waits/w1-busy-threads/busy-threads.json`: the first decision uses 80.5% of configured Concurrency and requests five pods, replacing the erroneous 1288% / eight-pod maximum. Subsequent fleet history, occupancy, backlog and completion timing follow the corrected controller decisions.
- `node/sim/scale-on-busy-threads/busy-threads.json` and `node/sim/corpus-w1-busy-threads/busy-threads.json`: the matching example/corpus simulations grow more gradually, so intermediate backlog, throughput, event fingerprints and latency change. Both still complete all 8,000 sampled requests, drain by 50 seconds, and end on four pods.
- `node/agent/describe/scale-on-busy-threads.json` and `node/agent/describe/corpus-w1-busy-threads.json`: the verified planner rerun reports backlog 1,158 instead of 832 and startup backlog 1,158 instead of 758, reflecting the corrected metric. The recommendation itself is retained.

No golden belonging to an origin/master diagram changes. No browser golden, schema or skill-reference fingerprint changes. After syncing, `node/i18n/catalogs.json` combines master's Confluence messages with this PR's eleven English keys: 2,582 → 2,593 messages, eleven additional fallbacks, and only the autoscaling/examples/threads area hashes changing relative to master. All other area hashes retain master's translations. The export script's introductory comment is condensed without changing behavior, keeping the refreshed skill ZIP at 834,807 bytes under the unchanged 835,000-byte limit.
