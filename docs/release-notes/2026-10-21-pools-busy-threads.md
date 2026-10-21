## Connection pools and busy-thread scaling

Request connections execute **Connection pool** in both waiting modes, using the
existing ledger reservations and indexed pending queue. Blocking pool waits keep
their threads; non-blocking waits release them. A deadline includes pool wait:
queued calls that time out are never sent and cannot produce a late reply.

HPA and KEDA's generated HPA accept the modelled Pods metric
`source: { kind: "pods", metric: "busyThreads" }`. Targets use a percentage of
Concurrency or an average number of threads per pod. Working and held threads
count; calls waiting off-thread do not. Cloud Run and App Service retain the same
ledger-backed held-call reads. ECS custom metrics remain unsupported, with an
explanation in Advanced.

Thread history is recorded before selecting the metric, so changing from CPU to
busy threads never interprets earlier held calls as an idle fleet.

Scenario sizing offers **Scale on busy threads** when waiting accounts for more
than half the observed busy threads and a same-seed rerun verifies a smaller
backlog and more successful completions. Moving requests into pool-held waits
alone is not an improvement. It preserves other metrics and KEDA triggers. It does not recommend a
metric change whose first new pod would only become ready at the scenario's end,
or raise a busy-thread maximum just to catch up with an already-drained backlog.

Two new public Reliability examples preserve the earlier examples unchanged:

- **Scale on busy threads** compares blocking on four pods, scaling to ten and
  draining, and non-blocking on four. It explicitly uses two requests per dot,
  one-second metric windows/cadence, five-second startup and down stabilization,
  a ten-pod maximum and 10% partner latency variation. Traffic stops at 40 seconds;
  the final ten seconds show drainage.
- **A pool of 40** compares blocking and non-blocking pool waits. The DB-only
  order-status route keeps completing while non-blocking payment calls queue.
  Payments can exceed the gateway timeout; those failures are explicit expectations.
  Sampling stays at one request per dot.

## Output parity

Every existing diagram-output golden is unchanged. New records cover both public
examples and the frozen `w1-busy-threads` and `w1-pool` corpus, including simulation,
thread/call histories, planning, checks, evidence, agent operations, traces, exports
and browser rendering/layout.

The six existing shared records change deliberately:

- `node/agent/tools.json`: resource metric sources gain the Pods/busyThreads union.
- `node/skill/public-schemas.json`: the same metric contract changes public schema
  hashes and sizes.
- `node/i18n/catalogs.json`: eleven English keys, the metric phrase and pool hint
  update catalog fingerprints and fallback counts; no translation stamps change.
- `node/skill/files.json`: refreshed spec, stencil reference and shorter format /
  simulation references. A smaller boundary example replaces the duplicate Kafka
  example; the sharing recipe points to the existing CLI; repeated prose is condensed
  to keep the skill ZIP below 835,000 bytes.
- `node/skill/current-stencils.json`: the new examples change usage ranking.
- `node/skill/validate.txt`: validation adds the two public and two corpus diagrams.

## Sampling limitation

The newly active blocking pool exposes a fractional-scale I1 mismatch: 999
scale-one completions become 798.91 at scale 1.01. The bound remains 22; the case
is a named expected failure with a [backlog entry](../backlog/2026-10-21-blocking-pool-sampling.md).
The existing pooled-deadline sampling gap remains pinned. No bound is relaxed and
no existing diagram golden is re-recorded to hide a mismatch.
