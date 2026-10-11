# Live view: simulation semantics

The live view animates messages flowing through any diagram, driven only by the diagram itself:
each node's stencil `simRole`, edge direction and `kind`, plus optional `props`. API: `src/sim/types.ts`.

## Model
- A **message** has an id, a `type` (e.g. `OrderPlaced`), a colour, and an `attempts` count.
- Messages travel along edges as **particles** (`progress` 0→1 over the edge's `travelMs` / speed).
- The engine is **pull-based at brokers**: a topic/queue/stream only hands a message to a consumer
  edge when the consumer has spare capacity (`inFlight + incoming < concurrency`, status `up`).
  This is what makes lag/backlog visibly build when a consumer is slow, paused or down.
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
| `store` | written (default 40 ms) | nothing (terminal). Sync edges into a store produce a `reply` particle back. |
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

## Snapshot
`snapshot()` returns particles, per-node state (`backlog`, `lag` per group, `inFlight`, `processed`,
`failed`, `deadLettered`, `dropped`, `throughput`), per-edge counters, recent events, and `inSystem`.
