# Live view: simulation semantics

The live view animates messages flowing through any diagram, driven only by the diagram itself:
each node's stencil `simRole`, edge direction and `kind`, plus optional `props`. API: `src/sim/types.ts`.

## Model

- A **message** has an id, a `type` (e.g. `OrderPlaced`), a colour, and an `attempts` count.
- Messages travel along edges as **particles** (`progress` 0→1 over the edge's `travelMs` / speed).
- The engine is **pull-based at brokers**: a topic/queue/stream only hands a message to a consumer
  edge when the consumer has spare capacity (`inFlight + incoming + pending < activeReplicas × concurrency`, status `up`).
  This is what makes lag/backlog visibly build when a consumer is slow, paused or down.
- Capacity is reserved while a delivery is travelling (like a consumer prefetch), so throughput per
  processor is about `activeReplicas × concurrency × 1000 ÷ (travelMs + latencyMs)` msgs/s at
  scale 1 (plus fixed-tick rounding). Travel time is a visual reservation, not a modeled network
  bandwidth limit. Analytic capacity excludes this reservation overhead.
- A processor with no outgoing edges is a terminal consumer (counts `processed`).
- Everything else is **push**: when a node finishes a message it sends it on immediately.
- Fixed internal step (e.g. 10 ms) and a seeded PRNG ⇒ identical runs for identical inputs.

## Roles

| Role        | On arrival                                                                                  | Sends on                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `source`    | — (injection / traffic start here)                                                          | a copy on **every** outgoing edge                                                                                                                                                                                                                                        |
| `gateway`   | short latency (default 60 ms), no concurrency limit                                         | **round-robin** across outgoing edges                                                                                                                                                                                                                                    |
| `processor` | waits in backlog, then processed (default 250 ms, concurrency 4); may fail by `failureRate` | on success, a copy on every outgoing non-DLQ edge                                                                                                                                                                                                                        |
| `topic`     | appended to the log                                                                         | per **consumer group** (edges grouped by `props.group`, default each edge its own group): each group gets every message, delivered to one edge of the group (round-robin among ready consumers), ≤ `partitions` active replicas per group, each with its own concurrency |
| `stream`    | same as `topic`                                                                             | same as `topic`                                                                                                                                                                                                                                                          |
| `queue`     | enqueued                                                                                    | **one** consumer across all outgoing non-DLQ edges (competing consumers)                                                                                                                                                                                                 |
| `store`     | written (default 40 ms)                                                                     | terminal, unless it has outgoing **async** edges: those model change feeds / CDC and each gets a copy. Sync edges into a store produce a `reply` particle back.                                                                                                          |
| `sink`      | received                                                                                    | nothing (terminal)                                                                                                                                                                                                                                                       |
| `none`      | passes through like a processor with 0 latency                                              | every outgoing edge                                                                                                                                                                                                                                                      |

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
  **DLQ edge** (`props.dlq: true`, or a broker/store target's label/sublabel matches
  `/dlq|dead.?letter/i` on an edge leaving a broker) as
  a `dlq` particle and counts `deadLettered`. No DLQ edge ⇒ `dropped`.
- `edge.props.dlq: false` always disables label inference. Consumer labels such as "no DLQ" never
  infer a dead-letter route, and nonbroker output never infers one. Explicit routes remain supported.
- `node.props.retry` defaults to `"requeue"`: return to the back of the original broker group.
  `"inplace"` keeps the same message, consumer slot and partition assignment until success or the
  delivery limit. `retryBackoffMs` (default 0) delays redelivery; in-place backoff blocks the slot,
  freezes while paused, and does not allow a long backlog to overtake the retry. An exhausted
  attempt goes straight to the DLQ path without another backoff. Checkpoints include retry state.
  This also applies when a consumer goes down while a reserved delivery is still travelling:
  arrival failures retain the work and reservation, allowing recovery or exhaustion to release it.
- A message pushed to a `down` node (not from a broker) is `dropped`.
- `paused` nodes accept and hold messages (backlog grows) but don't process or pull.

## Traffic & injection

- `inject(node, n, { type, spreadMs })` — starts n messages at that node as if it produced them
  (for a broker: as if they were just published to it). Direct engine injection counts simulated
  messages. Injecting into a sink or store with outgoing edges emits along them like a source,
  including sync edges; ordinary incoming messages still use the terminal/CDC role semantics.
- `setTraffic(true)` — every `source` emits continuously at real `ratePerSec` (default 2/s),
  divided by the engine scale.
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
- `edge.props.share` is an independent probability in 0..1 for each accepting fan-out edge from
  sources, processors, `none`, injected terminals, or async store change feeds. It is seeded; 0
  never copies, 1 always copies, and omission preserves existing fan-out. It is not a normalized
  split: two shares of 0.8 can both deliver one message. Gateways and competing broker routes
  ignore share. Filtering happens first, and edge renaming happens after selection.
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
profile. Bursts call `inject` once at their start, including `spreadMs`. Their sampled count is the
integer part of `count × trafficMultiplier ÷ scale`; the fractional remainder stays with that
profile. Counts are exact at scale 1.
Preview rates use half-open windows; an instantaneous burst is displayed as a 1 ms pulse, while its
actual injection is discrete. `trafficWindow` describes the scheduled start/end and
`estimateTotalMs` uses explicit duration, or the latest traffic/timeline end plus 10 s of drain
allowance, capped at 10 min.

A pausing note freezes runner and engine time until `resume()`, including following same-time
actions and traffic. Notes replace previous narration and expire after 6 simulation seconds;
waiting notes remain visible. Unknown action/injection/focus node ids are ignored; expectations
for unknown nodes remain pending. Static markers describe timeline actions and labelled traffic
window boundaries.

Expectations use allocation-free `measure()` at initialization, every tick and resume, converted
to real units before comparison. `always` fails permanently
on a violation, otherwise passes at completion; `eventually` passes permanently on first success,
otherwise fails at completion. `end` checks at completion; `at` checks once on crossing its time
(and fails if the run ends before that time). Every chip keeps its latest measured value. Named
`lag` reads that group; unnamed `lag` reads the maximum group lag; system metrics read `inSystem`.

A run stops at explicit `durationMs`, otherwise after traffic and timeline finish and `inSystem`
stays zero for 1.5 s. All runs stop by 600,000 simulation ms, including retained DLQ/backlog runs.
Retained quarantine scenarios therefore use explicit duration. `restart()` reloads the original
diagram and setup, resets speed to 1, and resets the seed, counters, traffic credits, saved multipliers and timeline.
Reused engines from `createEngine` are reseeded internally; custom `SimEngine` implementations
must supply their own deterministic seed because the public interface has no seed setter.

## Replicas, real units and sampling

Processors default to one replica and four concurrent messages per replica. Topic/stream groups
assign their partition budget fairly in stable diagram order across distinct consumer nodes;
duplicate edges do not create extra replicas. Every group has its own assignment. A node consuming
multiple groups shares its configured fleet and exposes the largest available assignment, not the
sum of independent fleets. Queue or push input makes the full fleet available, while each topic
input still respects its own assignment. Broker/store/gateway/sink targets use partition delivery
reservations, rather than processor replicas. Replica counts describe assignments, not busy instances;
status and lack of traffic do not change the idle-replica badge. Live replica/partition changes
reassign capacity, preserving work already running until completion.

`engine.setNodePropsBatch(patches, capacityMultiplier?)` applies all overrides before one assignment
pass over affected groups. Setup uses this API, including its capacity multiplier. Individual patches
skip assignment when effective replicas and broker partitions stay unchanged; concurrency changes
refresh cached group slot limits. Unrelated groups are untouched. Ordinary routes, dead-letter
classification, distinct membership and replica budgets come from the shared topology compiler in
`src/sim/topology.ts`; polling uses cached limits and skips empty groups.

`latencyMs` is sampled uniformly within ±`jitter` for each message and in-place retry. Jitter defaults
to 0.2; `jitter: 0` gives exact timings. The same seed, operations and tick sequence produce the same
jitter, routing and failures, including after checkpoint restore.

`Simulation.scale` defaults to 1 real message per simulated message. Saved profile rates/counts,
timeline injection counts and expectation values are all real units. Engine counters, `measure()`,
`metrics()` and direct `inject()` stay in simulated units. `snapshot().scale` and `frame().scale`
provide the weight. `toRealUnits`, `toSimulatedUnits`, `realNodeMetrics` and `realSnapshot` in
`src/sim/units.ts` convert counts, throughput and lag. Time, replica counts and particles keep their
native units; do not convert an already-converted snapshot again.

The runner exposes explicit views through `run.units.sampledFrame()`, `realFrame()`,
`sampledSnapshot()` and `realSnapshot()`. Real views have `units: "real"` and distinct exported types;
their counters, rates, edge totals and lag are weighted, while clocks, replicas, particles and
event/message identities remain sampled/native. `realFrame`, `realSnapshot` and `realNodeMetrics`
preserve that tag and avoid repeated conversion. `run.state()` contains scheduling metadata and
expectations in real units; `run.engine` remains the low-level sampled interface.

`run.inject(node, count, options?)` accepts real message counts; at scale 50, 100 messages produce
two sampled dots. Fractional credits accumulate independently per node and resolved message type,
so two 25-message injections produce one dot. Unknown nodes and invalid counts do not consume
credits. `run.injectAtSources(count, options?)` applies the count independently to every source-role
node. Manual injection is independent of the traffic multiplier; scheduled profiles and timeline
injections still use it. Restart clears manual credits. `spreadMs` always stays in milliseconds.

A sampled processor admission consumes `scale` messages of service budget while its visible work
keeps the configured per-message latency and parallelism. This preserves sustained real throughput
as scale changes. The budget begins empty and is bounded to at least one sampled message; coarse
sampling produces stair-step counters and approximate rare failures/branches. Unspent fractional
traffic credits below one dot are not emitted at run end. Use scale 1 for exact small-count claims.
Brokers keep sampled backlog; gateways/stores retain their unlimited parallel processing behavior.

`autoScale(simulation, diagram)` (exported from `simulation.ts` and `scale.ts`) returns the next
1/2/5-series weight so the conservative sum of entry peak rates is at most ~60 sampled messages/s.
It includes timeline injection batches and the traffic multiplier, ignores missing entry nodes,
and does not mutate the simulation.
Bursts use their spread duration, or one second for an instantaneous batch. This is an entry-rate
budget; graph fan-out and replies can draw more dots. An empty profile list uses source rates for a
free-play preview. Set the returned scale explicitly when starting a new run; live automatic scale
changes would alter counter history and sampling resolution.

`run.setMultipliers({ traffic?, capacity? })` partially patches live multipliers. Traffic applies to
future profile intervals, bursts and timeline injections; already scheduled spread batches keep their
count. Capacity multiplies base replicas, rounded to the nearest integer with a minimum of one.
Setup, timeline and `engine.setNodeProps` remain base properties: moving a capacity slider never
compounds or overwrites them. Zero traffic stops new input; zero capacity still leaves one replica.
Invalid multipliers are ignored. `run.state()` exposes current scale/multipliers. Direct engine users
can call `setScale` and `setCapacityMultiplier`; direct injection still takes sampled counts.

## Capacity analysis without playback

`analyzeCapacity(diagram, simulation?)` in `src/sim/capacity.ts` returns `nodes` keyed by id,
`bottleneck` (a node object), `suggestion`, `converged` and `iterations`. Each node has real msgs/s
`capacity`, peak `offered`, `utilization`, `replicas`, `activeReplicas` and `idleReplicas`. Without a
simulation it uses source `ratePerSec`; with one it uses saved profile peaks and setup overrides.
Traffic and capacity multipliers apply; scale does not change the analytic answer.

- Processor capacity is active replicas × concurrency × 1000 / latencyMs. Zero latency is unlimited;
  zero concurrency or a paused/down node has zero capacity. Positive demand / zero capacity is Infinity;
  zero demand / zero capacity is zero.
- Gateway/store capacity is 1000 / latencyMs as a single-lane planning estimate. The playback engine
  accepts parallel work at these roles, so this estimate is advisory rather than a throttle in playback.
- A queue's capacity is the sum of ready consumer capacities. Topics/streams use the slowest required
  consumer group, with replicas capped by that group's partitions; filtered groups normalize their
  capacity by the accepted fraction of incoming traffic. A broker with no consumers has zero capacity.
  For mixed types in a group, capacity uses compatible consumers only and accounts for shared service
  budgets via residual minimum cuts. A consumer accepting only unrelated types contributes no capacity;
  a blocked compatible route keeps its offered demand visible even when all matching weights are zero.
- Offered demand is propagated by message type: copies for fan-out and distinct groups, capacity-weighted
  shares for competing group members, equal gateway routing, filters, node/edge emits and probabilistic
  share. Duplicate group routes share their target's capacity. Injected terminal traffic follows output
  edges; normal terminal arrivals stop and store arrivals follow async change feeds. Intended downstream
  demand is not clipped at an upstream bottleneck.
- This is nominal peak planning. Summed profile peaks can overestimate nonoverlapping traffic. It excludes
  timeline chaos/injections, retry/failure cost, network travel reservations, jitter and broker storage/IO
  costs. Brokers accepting into another broker can buffer without a modeled ingest limit.
- Feedback demand iterates to a fixed point with 256 iterations and a 10¹² msgs/s per-type cap. Amplifying
  or unbounded cycles return `converged: false`; their numbers are capped estimates. Show that warning.

Use `utilization` for the heat map (guard Infinity), and `suggestion` for the callout. The most utilized
node is returned even below 100%; tied limits prefer the processor over its broker. Suggestions identify
idle replicas and partition increases, or a replica increase for an overloaded service. Analyze a copy
of the simulation with current live multipliers for an up-to-date panel; the analyzer has no engine state.

## Snapshot

`snapshot()` returns particles, per-node state (`backlog`, `lag` per group, `inFlight`, `processed`,
`failed`, `deadLettered`, `dropped`, `throughput`), per-edge counters, recent events, and `inSystem`.

`frame()` returns detached particles and per-node metrics plus `time`, `inSystem` and `scale`,
without edge counters or event-log copies. Use it for animation; call `snapshot()` for detailed inspection.

## Runner checkpoints and live scrubbing

`SimulationRun.checkpoint()` returns an opaque, reusable in-memory token with a `time`.
`restore(cp)` restores the engine and the complete runner state: timeline cursor, profile and
injection credits, fired bursts, expectations, note, waiting/completion flags, drain grace,
multipliers, speed and fractional fixed-step clock credit. Tokens belong to the runner that
captured them and become invalid after restart. Restoring a token and applying the same subsequent
steps and actions produces the same state as uninterrupted playback.

Live scrubbing keeps the origin plus at most 23 recent checkpoints, spaced five seconds apart.
It restores the nearest retained checkpoint at or before the requested time and advances the
remaining interval, skipping pausing notes on the way. Older positions can use the retained origin.
Plan and diagram changes invalidate incompatible samples. Automatic replay after changing rates or
sampling runs in cancellable slices of at most 200 ticks / roughly six milliseconds, yielding to
browser frames between slices. Restart and leaving live view cancel pending and active replay.

Manual real-count injection in free play and saved runs uses the shared injector in
`src/sim/injection.ts`, resolving omitted types before assigning fractional credit. Restart clears
credit; checkpoint restore reinstates it. Capacity saves validate the complete prospective document
against native persistence limits before changing the editor or clearing unsaved inputs.

## Message trace

Every message carries a **family** shared with its fan-out copies: `rootId` (on particles), a live-copy
count and, when recorded, a lineage. Fan-out keeps the original id on the first route; every other
route gets a new id with `parent` pointing at the message it was copied from (`copy` step). Renames
(`emits`) keep the id and show up as a type change between steps. Ids don't depend on tracing, so a
traced and an untraced run are identical.

`engine.tracer` (`MessageTracer`, `src/sim/lineage.ts`) records a family's steps: `emit`, `copy`,
`send` (edge, particle kind, arrival time), `arrive`, `start` / `done` (processing), `fail`, `retry`,
`deadletter`, `drop`, `park` (kept by a broker with no consumers, such as a DLQ) and `end`. A trace is
done when no copy is still travelling, queued or in process (parked copies count as finished).

- **What's recorded.** The followed family, plus a bounded history of recent ones
  (`setHistory(n)` or `EngineOptions.traceHistory`, default 0, at most 1,000; the live view keeps 160).
  When the history is full, the oldest finished family is evicted; if every slot is still in flight,
  new messages aren't sampled (so slow ones survive). Each family keeps at most 600 steps
  (`truncated` after that).
- **Choosing one.** `follow(messageId)` (a clicked particle, copies included), `followRoot(rootId)`
  (now, or as soon as that root is created), and `request({ next: "message", node? })` or
  `request({ next: "deadletter" })`. A message followed after it was created without being in the
  history starts a `partial` trace.
- **Determinism.** Recording draws no random numbers. The tracer state is cloned with the engine's
  messages in `checkpoint()`, so restoring a checkpoint restores recordings and what's followed.
  The live controller re-follows the same root after scrubbing (ids are deterministic).
- **Narration.** A timeline step `{ "do": "trace", "node": "orders" }` follows the next message to
  reach that node.

Pure readers in `src/trace/`: `buildJourney` (hops with latency, wait, processing and travel per hop,
totals, retries, dead letters), `buildSequence` (participants in path order, arrows, notes and gap
rows that say where the time went), `toMermaid` (`sequenceDiagram` text) and `toSvg` (the picture
shown in the app and downloaded, themed from the design tokens). `traceOnce` runs one trace headless
for the Lab and tests.
