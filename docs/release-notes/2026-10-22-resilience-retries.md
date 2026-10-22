## Retries with backoff, jitter and budgets

New diagrams use `p3-w2`. Request connections can execute saved retry policies, with a fresh timeout and pool admission per attempt. Blocking callers hold their thread through backoff; non-blocking callers resume once. Retries use a separate seeded stream, preserve abandoned downstream work and report ambiguous timeout retries. Execution stops at ten attempts, with a notice. Older revisions keep retries dormant; the upgrade preview includes saved simulation overrides, an option to keep retries off, and one-step Undo. Legacy export explains the loss.

A W2 diagram without an executable retry policy retains W1's failure replies byte for byte, verified on every tick of a processing failure. Parallel branches count overlapping backoff once in response latency.

The Inspector adds Retries beside the timeout, with details and pool settings behind disclosures. The existing call pill shows amplification; the Calls hover, latency breakdown, trace, slow motion and event log explain attempts and backoff. Planning includes expected retry load, backoff residence and one shared budget per connection. A pool is free during backoff.

**A retry storm** keeps the 60-second run and faults at 1–2 and 3–8 seconds. Payments has 48 threads (4 × 12), 80 ms work, 600 attempts/s healthy capacity and 50% configured utilization at 300 checkouts/s. Measurements at scale 1 across seeds 1, 7, 17, 42 and 99:

| Simulation          | Queue at 8 s | Queue at 15 s | Peak queue    | Recovery            | End queue / Shop goodput        |
| ------------------- | ------------ | ------------- | ------------- | ------------------- | ------------------------------- |
| Three quick retries | 3,597        | 9,081         | 33,735        | Still stuck at 60 s | 33,735 / effectively 0/s        |
| Jittered backoff    | 3,533–3,552  | 9,016–9,029   | 33,425–33,494 | Still stuck at 60 s | 33,425–33,494 / effectively 0/s |
| A retry budget      | 1,316–1,320  | 3,019–3,024   | 3,994–4,012   | 37.8–37.9 s         | 3 / approximately 300/s         |

Recovery means Shop goodput ≥270/s and Payments backlog <100, sampled every 100 ms of simulation time. Queued attempts retain the service duration assigned during the slowdown. The blip is mostly absorbed, rather than promising zero failures for every seed. Chips retain the measured end targets: ≥270/s goodput, <100 queued and <1.5 attempts/request. Naive retries and jitter fail all three; the budget passes all three.

**A slow payment provider** gains **Three retries hold threads**: three 600 ms attempts and two 100 ms backoffs can hold a thread for two seconds. The comparison is with the single 600 ms timeout. We do not claim threads fill twice as soon as in No timeouts: both runs hold the same first wave while the provider takes two seconds, so that target is incompatible with the unchanged fault timing.

Six existing shared golden files intentionally change: `node/agent/tools.json` and `node/skill/public-schemas.json` gain the revision, retry fields and metrics; `node/i18n/catalogs.json` records new English keys and fallbacks; `node/skill/files.json` records the generated spec and updated retry/revision guidance; `node/skill/current-stencils.json` includes the new showcase's usage; `node/skill/validate.txt` adds the eight frozen W2 fixtures. No existing diagram-output golden is re-recorded. The released payment lesson is frozen as a W1 compatibility input; the complete upgraded example has separate `w2-slow-payment-provider` Node records. New records cover both showcases and their Node exports, eight `w2-*` corpus diagrams, real counters at scales 1/2/10, and the new showcase's browser rendering and layout. Checks rule lists remain unchanged; resilience findings come in PR 4.

The skill's generated Node bundles have whitespace removed without additional compression transforms or name mangling, retaining the 835,000-byte ZIP budget. No bundle budget or plugin version changes.

There are 211 new parity records. The additional geometry unit snapshot is solely the new retry-storm drawing; no existing route snapshot changes. Browser neighbour tests retain their original handle-hit assertion and explicitly wait for lazy attachment geometry before using the ports.
