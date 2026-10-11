# Live view: simulation semantics

The live view animates messages flowing through any diagram, driven only by the diagram itself:
each node's stencil `simRole`, edge direction and `kind`, plus optional `props`. API: `src/sim/types.ts`.

## Model
- A **message** has an id, a `type` (e.g. `OrderPlaced`), a colour, and an `attempts` count.
- Messages travel along edges as **particles** (`progress` 0→1 over the edge's `travelMs` / speed).
- The engine is **pull-based at brokers**: a topic/queue/stream only hands a message to a consumer
  edge when the consumer has spare capacity (`inFlight + incoming < concurrency`, status `up`).
  This is what makes lag/backlog visibly build when a consumer is slow, paused or down.
- Capacity is reserved while a delivery is travelling (like a consumer prefetch), so throughput per
  consumer group is about `partitions ÷ travelMs` and per processor about
  `concurrency ÷ (travelMs + latencyMs)`. Raise `partitions` / `concurrency` for high-rate scenarios.
- A processor with no outgoing edges is a terminal consumer (counts `processed`).
- Everything else is **push**: when a node finishes a message it sends it on immediately.
- Fixed internal step (e.g. 10 ms) and a seeded PRNG ⇒ identical runs for identical inputs.

## Roles
| Role | On arrival | Sends on |
|---|---|---|
| `source` | — (injection / traffic start here) | a copy on **every** outgoing edge |
| `gateway` | short latency (default 60 ms), no concurrency limit | **round-robin** across outgoing edges |
| `processor` | waits in backlog, then processed (default 250 ms, concurrency 4); may fail by `failureRate` | on success, a copy on every outgoing non-DLQ edge |
| `topic` | appended to the log | per **consumer group** (edges grouped by `props.group`, default each edge its own group): each group gets every message, delivered to one edge of the group (round-robin among ready consumers), ≤ `partitions` in flight per group |
| `stream` | same as `topic` | same as `topic` |
| `queue` | enqueued | **one** consumer across all outgoing non-DLQ edges (competing consumers) |
| `store` | written (default 40 ms) | terminal, unless it has outgoing **async** edges: those model change feeds / CDC and each gets a copy. Sync edges into a store produce a `reply` particle back. |
| `sink` | received | nothing (terminal) |
| `none` | passes through like a processor with 0 latency | every outgoing edge |

## Sync vs async edges
- `async` edges carry messages (dashed, particles).
- `sync` edges are request/response: the message travels to the target, and when the target is a
  terminal (`store` / `sink`) or finishes processing, a `reply` particle travels back. The caller
  does not wait for the reply (keep it simple) — the reply is visual.

## Failure, retry, dead-letter
- A processor fails a message with probability `failureRate`, or always while its status is `down`.
- If the message came from a broker (queue/topic/stream), it's redelivered: a `retry` particle goes
  back to the broker, `attempts++`, and the broker re-offers it to the same consumer group.
- When `attempts` reaches the broker's `maxDeliveryCount` (default 3), the broker sends it along its
  **DLQ edge** (`props.dlq: true`, or the target's label/sublabel matches `/dlq|dead.?letter/i`) as
  a `dlq` particle and counts `deadLettered`. No DLQ edge ⇒ `dropped`.
- A message pushed to a `down` node (not from a broker) is `dropped`.
- `paused` nodes accept and hold messages (backlog grows) but don't process or pull.

## Traffic & injection
- `inject(node, n, { type, spreadMs })` — starts n messages at that node as if it produced them
  (for a broker: as if they were just published to it).
- `setTraffic(true)` — every `source` emits continuously at `ratePerSec` (default 2/s).
- Message colour comes from its type (stable hash → palette), so different event types are distinct.

## Typed routing
- `edge.props.filter` applies to downstream requests/messages on sync, async and DLQ edges.
  Omitted means accept every type; an empty array accepts none. Entries match exactly, except a
  trailing `*` matches a prefix (`Order*`); `*` accepts everything.
- Processors and `none` nodes apply `node.props.emits` before choosing outgoing edges. A string
  renames every forwarded message; a map uses an exact incoming-type key, then `"*"` as fallback,
  otherwise leaves the type unchanged. Filters see this resulting type.
- `edge.props.emits` overrides the type after the edge accepts the message. Renaming also updates
  its colour, independently for each outgoing copy. Replies remain visual responses to accepted
  requests and do not undergo another filter/rename pass.
- Gateways round-robin across accepting edges. Sources/processors fan out across accepting edges;
  stores copy to accepting async change feeds. No accepting route ends that branch without a drop.
- A broker group skips types rejected by all its edges, so its lag contains only accepted pending
  messages. Within a group, delivery uses accepting ready consumers in round-robin order, retaining
  FIFO when the first pending message has no ready matching consumer. Retry restores the original
  broker type before routing again, even when a delivery edge renamed it. A rejected DLQ route drops
  the exhausted message instead of delivering it.

## Saved simulation runner
`createSimulationRun` in `src/sim/simulation.ts` loads the diagram with the saved seed (default 1),
applies setup, and runs traffic plus a stably sorted timeline. Runner scheduling uses the engine's
10 ms simulation ticks. An action between ticks fires at the next tick; speed changes alter wall
time only. At the same time, timeline actions run in their saved order before traffic is injected.

Each continuous traffic profile has its own fractional message accumulator. Constant, ramp and
spike rates are integrated exactly across shape boundaries; fractional remainders stay with their
profile. Bursts call `inject` once at their start, including `spreadMs`, so their count is exact.
Preview rates use half-open windows; an instantaneous burst is displayed as a 1 ms pulse, while its
actual injection is discrete. `trafficWindow` describes the scheduled start/end and
`estimateTotalMs` uses explicit duration, or the latest traffic/timeline end plus 10 s of drain
allowance, capped at 10 min.

A pausing note freezes runner and engine time until `resume()`, including following same-time
actions and traffic. Notes replace previous narration and expire after 6 simulation seconds;
waiting notes remain visible. Unknown action/injection/focus node ids are ignored; expectations
for unknown nodes remain pending. Static markers describe timeline actions and labelled traffic
window boundaries.

Expectations sample snapshots at initialization, every tick and resume. `always` fails permanently
on a violation, otherwise passes at completion; `eventually` passes permanently on first success,
otherwise fails at completion. `end` checks at completion; `at` checks once on crossing its time
(and fails if the run ends before that time). Every chip keeps its latest measured value. Named
`lag` reads that group; unnamed `lag` reads the maximum group lag; system metrics read `inSystem`.

A run stops at explicit `durationMs`, otherwise after traffic and timeline finish and `inSystem`
stays zero for 1.5 s. All runs stop by 600,000 simulation ms, including retained DLQ/backlog runs.
Retained quarantine scenarios therefore use explicit duration. `restart()` reloads the original
diagram and setup, resets speed to 1, and resets the seed, counters, traffic credits and timeline.
Reused engines from `createEngine` are reseeded internally; custom `SimEngine` implementations
must supply their own deterministic seed because the public interface has no seed setter.

## Snapshot
`snapshot()` returns particles, per-node state (`backlog`, `lag` per group, `inFlight`, `processed`,
`failed`, `deadLettered`, `dropped`, `throughput`), per-edge counters, recent events, and `inSystem`.
