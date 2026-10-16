# Live view: simulation semantics

The live view animates messages flowing through any diagram, driven only by the diagram itself:
each node's stencil `simRole`, edge direction and `kind`, plus optional `props`. API: `src/sim/types.ts`.

## Planning revision p3: managed admission

New diagrams use `diagrams/v2` with `planning: { revision: "p3" }`. Legacy, p1 and p2
files retain their previous resolver and playback until an explicit, undoable upgrade. Upgrades
materialize existing values; choosing a vendor preset is a separate, undoable action. Unknown
vendor budgets remain unknown, including PayPal and Iterable. No numeric model-API default is
invented: enter the org/project/model/tier contract and per-request token or cost sizes.

Serverless, external APIs, model APIs and API gateways now spend duration, can fail, and check
admission before work starts. `api.quotas` contains bounded token buckets with an explicit unit,
amount, window and optional burst. Requests, tokens, input/output tokens, cost points and bytes
remain distinct. A sample consumes `scale` real requests and its represented token/cost amount.
Every applicable node, account and endpoint bucket is checked before any is charged. Shared
buckets are charged once per attempt, even if referenced at both scopes. Shared definitions must
agree; conflicting definitions refuse all affected callers before the first account token is spent.
Refill uses the fixed-step simulation clock, never wall time, and checkpoints restore bucket credit
and concurrency reservations. Live edits retain spent credit instead of granting a fresh burst.

`api.maxInFlight` caps simultaneous calls. `api.sharedConcurrency` names an account allocation;
`planning.sharedAllocations` is authoritative, otherwise an agreed implicit definition supplies
its cap. Preset account concurrency is independent of a node's smaller local concurrent-call limit.
`planning.sharedQuotas` defines shared token buckets; node/endpoint references include matching
unit, amount, window and burst. Labels identify local scopes, never credentials. Duplicating a
visual Stripe API or Lambda function does not duplicate the default account/Region allocation.

An optional Request `endpointId` targets an endpoint's opaque id. Endpoint duration/errors inherit
from the node when omitted. Endpoint budgets add to global budgets; a dangling endpoint refuses
admission instead of silently falling back. Stripe presets supply the cited default endpoint rate
for declared endpoints when no endpoint quota was authored. Without endpoints, the diagram models
global standard API traffic only. Endpoint authoring UI and OpenAPI import remain P6/P7 work.

Serverless `maxConcurrency` is an allocation of concurrent executions, not incoming RPS. Fixed
mode uses fixed slots within that allocation; automatic mode can use the allocation on demand.
**Automatic mode explicitly assumes instant scaling**: cold starts, scale-up ramps, execution
timeouts and trigger-specific retries are excluded. Fixed fleets retain P2's partition assignment;
SNS subscription workers use the full fleet. Capacity multipliers do not multiply vendor budgets.

Published preset revision `2026-10-14`:

| Preset                     | Scoped budget                                                                          | Evidence                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Lambda account/Region      | 1,000 simultaneous executions shared by functions                                      | [AWS concurrency](https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html); newer accounts can have lower quotas |
| Stripe live account        | 100 requests/s global; 50 simultaneous calls; declared endpoints 25 requests/s         | [Stripe limits](https://docs.stripe.com/rate-limits); account/endpoint exceptions apply                                       |
| Stripe sandbox account     | 25 requests/s global; declared endpoints 25 requests/s; concurrent-call budget unknown | [Stripe limits](https://docs.stripe.com/rate-limits)                                                                          |
| API Gateway account/Region | 10,000 requests/s, bucket capacity 5,000 requests                                      | [AWS quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html); excluded Regions have lower quotas    |
| Measured workload          | No vendor quota supplied                                                               | Duration/error inputs are editable assumptions                                                                                |

Mean durations (250 ms for external/function examples; 60 ms for the gateway) and unspecified
vendor burst behaviour are assumptions, not vendor latency measurements or SLA guarantees.
Stripe's modelled bucket capacity defaults to one second of its rate; AWS Gateway's documented
burst is explicit. Model APIs' RPM/TPM values stay account/model-specific and unknown until entered.

Sampling is discrete: for a simultaneous burst the admitted count differs by **less than one dot**
(`scale` real requests) at each independent binding budget. Repeated refill/arrival intervals can
accumulate rounding error; the clock also quantizes admission to 10 ms. Use scale 1 for exact small
quota/concurrency boundaries. A cap smaller than one represented dot cannot admit that dot.
The regression compares 200 real calls against a 103-request bucket: scale 1 admits 103, scale 10
admits 100. Never interpret the sampled concurrency cap as instant scaling or a measured p95.

Live counts **rejected** separately from failed attempts, dropped messages, dead letters and denied
firewall traffic. Refused admission never enters processing or a service backlog; visual replies
finish the attempt without propagating a caller failure. External processing errors count as failed
operations rather than also inventing dropped traffic. Broker delivery retries retain the existing
consumer policy; admission refusal does not invent a vendor's trigger retry. Caller `deadlineMs`,
retry policy and pool contracts are validated and preserved but **not executed**. Caller waits,
deadlines, retries and failure cascades remain item 10.

Planning combines the offered workload across shared and endpoint constraints as a steady-state
common workload multiplier. It reports the binding rate/concurrency/token/cost budget and potential
refusals, not growing SaaS backlog. Suggestions say **Increase allocation** or **Reduce calls**;
there is no replica fix for managed APIs. Unknown limits are labelled unknown rather than unlimited.
Burst timing, cold starts, caller waits and retries are excluded from this estimate.

## Planning revision p2: logs and named routes

The p2 model uses `diagrams/v2` with `planning: { revision: "p2" }`. Existing v1 and p1 files keep
exactly their previous broker allocation until the person previews and applies an explicit upgrade.
The upgrade pins effective defaults and preserves groups, overrides and saved simulations; it can
change broker capacity, which the preview lists. Undo restores the previous document/model. Legacy
export warns that p2 allocation cannot be represented by the older model, even with pinned numbers.

The small broker metadata table (`src/model/brokers.ts`, exposed through family profiles) resolves once
with node settings. Playback, analysis and sizing share `allocateGroupReplicas`:

| Broker                                       | Instance assignment                                     | Name on outgoing ordinary routes |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------- |
| Kafka topic, Event Hubs                      | At most one reader instance per partition in each group | Consumer group                   |
| Kinesis                                      | At most one reader instance per shard in each group     | Consumer group                   |
| SNS, EventBridge, Service Bus Topic, Pub/Sub | Every configured reader instance can work               | Subscription                     |
| RabbitMQ exchange                            | Every configured reader instance can work               | Binding                          |
| Queue                                        | Readers compete using their full configured fleet       | No group setting                 |

Each group/subscription/binding name receives a copy; edges sharing the name compete for that copy.
Duplicate edges do not allocate extra instances. Each assigned processor instance keeps all of its
configured parallel slots. Explicit `dlq` routes are excluded from subscribers, assignment, capacity,
capabilities and the group editor/readouts. `kafka.cluster` is infrastructure (`none`), not another topic:
it has no partitions or consumer groups and imposes no second broker assignment.

Non-partitioned fan-out has no broker-hop reservation cap, partition control, partition sizing fix or
partition preset. Logs retain their existing assignment and pipeline reservations. Instant broker
targets still acknowledge on arrival; travel remains animation rather than an ingest throughput limit.
Inspector, Inputs, fixes and explanations use partitions, shards, subscriptions and bindings. The
one shared node pool still prevents two subscriptions from inventing independent worker fleets.
Uncapped reservations do not add physical network-device units: queue/subscription capacity uses the
configured fleet and its finite throughput. Mixed incoming logs associate the displayed noun with the
allocation supplying the reported count; each broker keeps its own group/subscription/binding lag heading.
Planning revision changes invalidate open edit-mode capacity and live playback, including Undo when
the graph itself is unchanged. Check/agent results stay deterministic English; broker descriptors translate
in the UI, independently of worker execution.

`messageKB` records a broker's producer payload size; `ingestUnits` records provisioning in its
profile's native ingest unit. Both stay optional, have file-format validation, and round-trip to agent
and HTML output. They impose no hard vendor ingest ceiling and offer no ineffective new controls.
Kafka keys, ordering, share-group delivery, retention changes and the P4 retry overhaul are excluded.

## Planning revision p1

`src/stencils/profiles.ts` explicitly maps every catalogue stencil to a behavioural family. Unknown
ids retain legacy role behaviour. The common resolver (`src/sim/defaults.ts`) supplies playback,
analysis, checks and explanations with the same settings, evidence and real units. P1 adds metadata
and pinned versions; partition assignment, broker policies, serverless scaling, quotas and request/reply
completion semantics retain their existing behaviour.

Resolution is role defaults, opted-in family defaults, a pinned preset, node props, simulation setup,
then live Inputs/tweaks. `processor-lesson` revision `1` keeps existing workload assumptions;
`device-size` revision `1` uses existing approximate device presets. Behaviour-critical values are
stored alongside the revision. Choosing a device size pins its throughput and service time together.
Node `replicas × concurrency` is one shared pool across all inputs. Consumer `group` stays on the
edge; omitted legacy groups still use the edge id.

Files without `planning` keep the legacy resolver and omitted defaults. P1 introduced
`diagrams/v2` with `planning: { revision: "p1" }`; P2 is now the new-diagram default. **Opening a v1 file never upgrades it.** Diagram
properties previews affected nodes and before/after capacity, then pins today's values in one undo
step, preserving authored groups, relationships, overrides and saved simulations. Simulations inherit
their document's revision. Unsupported model/preset revisions are refused, including setup/timeline
presets. Older readers reject v2. Legacy export previews discarded model/preset/store-slot/delay
metadata and keeps pinned numeric values, preserving P1 playback. Both native schemas and current
agent/HTML readers support the appropriate formats.

Connections rows derive Consumes / Publishes / Calls from compatible flows. Dependencies, deny rules
and dead-letter routes grant no ordinary consumer capability. Two topics show separate policies and
one pool; HTTP-only services have no consumer rows. Removing/reconnecting an edge updates the view.

Contextual explanations use the analysis's per-connection **real** demand and playback's resolver.
A 1-replica × 4-slot processor at 4 seconds handles ~1 req/s; at 3 req/s demand, three replicas reach
100% utilization and six reach the chosen 50% target. The primary fix uses the existing sizing planner,
including necessary partition/device changes, as one undo step. Other capacity surfaces retain their
existing 55% sizing target. Configured estimates and current-run metrics are labelled separately;
tagged real metrics are never multiplied by dot scale again. Down/paused processors report zero
available capacity without replica sizing; nonconverging demand offers no sizing action. Slow motion
disables mutation actions.

The existing hover card and inspector provide these readouts and keyboard access. The banner remains
run-level status, the callout owns urgent observed trouble and one action, and checks retain structural/
configured findings with ignore/off. No second warning engine or top-bar control was added. No-reader
shares `no-reader:<id>` and the existing Add a consumer action. `describe_diagram` exposes resolved
capabilities and numerical explanation data for modest graphs.

`travelMs` remains legacy transit/animation timing. `networkDelayMs` is physical one-way delay, unknown
when absent: P1 stores it as bounded metadata, never adds it to animation time, and never reports
animation as measured network latency. Store `connections` is a connection ceiling; `querySlots`
is concurrent active queries. Both are distinct bounded metadata, currently unmodelled. Stores still
accept parallel work; no ineffective new controls are shown.

## Model

- A **message** has an id, a `type` (e.g. `OrderPlaced`), a colour, and an `attempts` count.
- Messages travel along edges as **particles** (`progress` 0→1 over the edge's `travelMs` / speed). An edge
  without `travelMs` takes **300 ms** for a message and **200 ms** for a request (`DEFAULT_TRAVEL_MS` in
  `src/sim/topology.ts`; it was 900 / 450 before 2026-10, when every public example set 200–300 by hand).
- The engine is **pull-based at brokers**: a topic/queue/stream only hands a message to a consumer
  edge when the consumer can take it (status `up`), so lag/backlog visibly builds when a consumer is slow,
  paused or down.
- **A delivery takes its consumer's slot when it arrives, not when it leaves the broker.** Travel is pipelined:
  the broker keeps at most `units + ⌈units × travelMs ÷ latencyMs⌉ + 1` deliveries outstanding (travelling,
  waiting at the consumer, or in work) against `units` slots, enough to keep every slot busy plus a prefetch of
  one. For a processor `units` is `activeReplicas × concurrency` ÷ scale (a sampled dot costs `scale`
  messages of service budget), so at a sampling scale the backlog stays at the broker. A non-processor target with
  no service time (a broker, a sink) is never the limit, so a topic → queue hop builds no lag; a 0 ms processor is
  paced as one tick (10 ms), so a burst can't pull a whole backlog onto the edge. A broker-fed
  consumer therefore drains at `activeReplicas × concurrency × 1000 ÷ latencyMs`, what capacity analysis, the heat
  map and the `capacity` check report (seeded ratios in `src/sim/drain.test.ts`: 0.95–1.0 with jitter, the tick's
  rounding included, exactly 1.0 without). Travel time is animation, never a throughput limit.
- **A partitioned log group never works on more than its partitions or shards allow**, even at a consumer with free slots from other
  inputs (a push input, another group): a delivery arriving while its group's `allocation × concurrency` slots at
  that node are taken is **staged** there, in a queue per group and consumer, and the next one joins the node's queue
  each time a group slot frees (or the group gets more): nothing rescans the backlog per tick. Staged deliveries
  count in the node's backlog, travel in checkpoints and are found by the tracer. A deny rule in a group (a firewall
  route, `deny`) takes no slot and stages nothing: its target isn't a consumer.
- **An in-place retry keeps a slot only if it has one**, or one is free (the node's and its group's): deliveries
  prefetched to a consumer that goes down fail on arrival, one per free slot retries in place, and the rest go back to
  the broker, so a revived consumer never works past its concurrency or partitions.
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

Service time is resolved centrally by `hasServiceTime` in `src/sim/defaults.ts`: only processors, gateways and stores use latency. The inspector derives sink latency applicability from that same rule. Paused/injected/resumed sink work therefore finishes without a saved delay, just as arriving sink work does.

## Sync vs async edges

- `async` edges carry messages (dashed, particles).
- `sync` edges are request/response: the message travels to the target, and when the target is a
  terminal (`store` / `sink`) or finishes processing, a `reply` particle travels back. The caller
  does not wait for the reply (keep it simple) — the reply is visual.
- **A new edge's kind** comes from the stencils at its ends (`inferKind`, `src/stencils/edgeKind.ts`): `sync` into
  a store, a sink (an outside API, email, a partner), a gateway or a model API (OpenAI, Claude, an LLM, an ML model),
  or out of a client (`client.*`, a webhook) or a gateway; `async` into or out of a queue, topic, stream or Kafka
  Cluster, which wins, and otherwise. Drawing, quick-add, Alt+arrow and the live view's "Traffic into X" use it; an
  inferred dependency (Key Vault, App Configuration…) wins over it. An agent's `connect` without a `kind` gets the
  same default (`async` with a `relation`). Files keep the kinds they have: an edge without `kind` is still `async`.

## Dependencies

- An edge's `relation` says what it means. Absent (or `"flow"`) is a flow and everything above applies.
  `config`, `secret`, `identity`, `telemetry`, `deploy` and `depends` are **dependencies**: they carry no
  messages, no particles and no traffic.
- `compileTopology` (`src/sim/topology.ts`) leaves them out, so the engine, capacity analysis
  (`analyzeCapacity`), the tracer and sequence diagrams never see them; nor do entry-point detection,
  consumer-group lists or the storm builder. A diagram with dependencies runs exactly like the same diagram
  without them, seed for seed (`src/sim/relations.test.ts`).
- Flow-only fields on a dependency (`kind`, `props.group`, `dlq`, `filter`, `share`, `emits`) stay in the
  file untouched, so switching it back to a flow restores its behaviour.
- The live view dims dependencies to about 35% (full strength on hover); the decorator never marks them
  active. Config and Secret say why in their tooltip and the edge inspector: "Read at startup and refreshed, not on
  every request, so no messages flow over it." (`RELATION_META[...].why`, `src/model/relations.ts`).
- **A stencil change re-infers its edges** (`reinferRelations`, `src/stencils/relations.ts`), in the same undo step,
  with a toast that says what changed and offers Undo ("2 connections are now Config: no messages flow over them").
  `edge.relationOrigin` says who set the relationship:
  - `inferred` (from the stencils: an edge drawn into a typed stencil, or a stencil change): it follows its ends.
    A node that stops being a config store, a secret store, an identity, a telemetry backend, a deployer or a
    depends-on stencil turns its inferred dependencies back into flows (or into what its new stencil implies).
  - `explicit` (someone chose it: Relationship ▸, the inspector, Ctrl+K, Make it a flow, the inspector's Apply): it
    never changes by itself. A connection made a flow with Make it a flow stays a flow.
  - Absent (older files, imports, files written by hand): a flow becomes the dependency its ends now imply; a
    dependency stays as it is, since nothing says it was inferred.

  The same holds for every way a stencil changes: the inspector (one node or a bulk edit), the node's right-click and
  Ctrl+K (Change stencil), and the agents' `edit_diagram` `update` with `kind`, whose result lists the re-inferred
  connections (`relations`, at most 50 per op and 200 per batch; `relationsOmitted` counts the rest) and says so in a
  sentence (`note`, which counts them all). Pasting and importing change no stencil, so they keep their edges as they
  are. A relationship someone picks is `explicit` even when it's the one the edge already had (Request on a Message,
  Config on an inferred Config).

- Not yet (phase 3 of `docs/research/diagram-semantics.md`): dependency outages. A `when` of `startup`,
  `cached`, `request` or `never` is accepted on a dependency and kept, but the engine doesn't read it.

## A topic or queue nobody reads

A broker with no ordinary route out (a dead-letter route doesn't count) has no consumer. The engine keeps what
reaches it (`park` in the trace) and its frame says so (`noConsumer: true`). What that's called depends on the broker:

- **A topic or stream** keeps what's published, read or not, as Kafka, Event Hubs and Kinesis do. It isn't overloaded,
  and it has no lag: lag is per consumer group, and it has none. Live says **Nobody reads this yet · 297 kept** on its
  badge, **Kept** in its hover card with one line on why there's no lag, and the heat map paints it amber (a warning,
  not the pulsing red of an overload), with **Nobody reads this yet · 2/s kept**. Its backlog glow stays faint.
- **A queue** (Service Bus, SQS, RabbitMQ) holds messages that wait for a consumer: **297 queued**, and **No consumer
  · 2/s waiting** on the heat map, in red.
- **The banner** (Show capacity's callout) leads with it: **Nobody reads Kafka Topic**, "It keeps what's published, but
  nothing consumes it. Partitions can't change that: add a consumer." (a queue: "Messages wait in it until a consumer
  takes them."), and one action, **Add a consumer**: a service one gap downstream, reading it (the stencil of a
  service that publishes to it, else a generic service), named "Kafka Topic consumer", one undoable step, in live
  view or editing. The diagram changed, so the run restarts with the consumer reading the topic (the kept messages
  aren't carried over).
- **Paused and down** keep their own words ("Kafka Topic is paused"), separate from nobody reading it. "Can't keep up
  at all" is left for a broker whose consumers can't take any of its messages.
- **Partitions** only cap how many consumers in one group work at once: they don't speed up publishing, and with no
  consumer they change nothing. The inspector says so under Partitions, and the Inputs panel, once partitions are
  raised past the saved value on a topic nobody reads or with fewer consumer replicas than partitions, says why that
  can't help (`partitionsNote`, `src/live/capacityModel.ts`).
- **Slow motion** says "kept in Kafka Topic: nobody reads it" (a queue: "parked in …"), and ends on "Kept in Kafka
  Topic, unread". The trace card's status is **Kept** (a queue: **Waiting**).
- **Checks** agree: `no-reader` says a topic "keeps every message, unread", a queue's messages "pile up".

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
- A message pushed to a `down` node (not from a broker) is `dropped`. A consumer fed only by brokers loses nothing
  while it's down: the brokers stop delivering to it and keep its messages, so the callout and its badge say they
  **wait** ("Messages wait in orders until it's back", "Down · 2/s waiting in orders"); "fail" is for nodes requests
  are pushed to. The `capacity` check calls a node saved down **down**, not one that can't keep up.
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

## Network devices

Routers, switches, firewalls and ADCs (`src/stencils/netDevices.ts`; research and sources in
`docs/research/network-infrastructure.md`) are gateways with three additions. Every other gateway behaves as above.

- **Throughput ceiling.** A device's stencil has size presets (`size`: `branch`, `campus`, `datacentre`; families made
  for data centres have no branch). Each gives a datasheet throughput per unit in Gbps and a latency, and `gbps` and
  `latencyMs` override them.
  - **The ceiling** is `gbps × 10⁹ ÷ 8 ÷ (messageKB × 1,000)` real messages/s per unit (`messageKB` defaults to 64:
    1 Gbps is 1,953 messages/s), times the units carrying traffic.
  - **In playback** a device admits at most its ceiling, as a token bucket in sampled dots (`ceiling × step ÷ scale`
    per tick, banking at most one message plus a tick's worth, so fractional rates keep their remainder), and the rest
    waits in its backlog. Nothing is dropped for being over the ceiling.
  - **In analysis** (`analyzeCapacity`) a device's capacity is the same ceiling, flagged `device: true`, so live view's
    heat map colours it. Other gateways stay unmodeled.
  - **Explicit throughput:** any gateway with an explicit `gbps` gets a ceiling too.
  - **Sizing** is the shared planner's (`sizingFix`, src/sim/capacityPlanning.ts): a device at 90% or more moves to the
    smallest bigger size that lands it under 55%, with a `gbps` typed over the old size moved to the new size's figure.
    The capacity check turns it into edit ops, live view into overrides. Capacity × scales a device's units like a
    service's replicas, and Save to diagram keeps them.
- **Units and high availability.** `replicas` are units, and `ha` says how they work:
  - `standalone` (default): one box.
  - `active-standby`: one unit carries traffic whatever the count. Choosing it starts at two units.
  - `active-active`: units add up.
  - **Failover:** when a props change lowers an active-standby pair's own `replicas` during a run (the pair still up,
    at least one unit left), it fails over. It holds its traffic for `failoverMs` (default 3,000), logs a `status`
    event ("failing over to the standby (1 of 2 units left)") and reports `failingOver: true` in its node state; then
    it drains. Nothing is dropped.
  - **Clusters:** an active-active cluster losing a unit has no hold, only less capacity.
  - **Not a failover:** the capacity multiplier changes effective units, never a pair's own count, so it never
    triggers one, alone or in the same batch as other props. A unit missing at time zero (a simulation's setup) is
    where the run starts. A pair that's down drops what's sent to it, like any node.
- **Health checks.** With `healthChecks` (default on for ADC stencils, off for every other gateway), a gateway leaves
  targets whose status is `down` out of its round-robin while any other target is up, in playback and in analysis.

### Deny rules

An edge's `deny: true` is a deny rule. Every downstream delivery goes through one place in the engine, which blocks a
message routed onto a denied edge at the edge's source: a gateway's round-robin pick among accepting edges, a fan-out
copy, a store's change feed, a broker's delivery (a denied route is always ready and reserves no consumer slot, so a
retried message offered again is blocked too) and a dead letter (a denied dead-letter route blocks the message; it's
neither dead-lettered nor dropped). Replies and retries travel back and aren't deliveries.

- **How it counts:** the node's `blocked` counter (in node state when above zero, and as an expectation metric), a
  `block` event, and a trace step of its own kind, `block`. The journey counts it in `blocked` (never `dropped`),
  the sequence diagram shows a neutral "Blocked by a deny rule" note and "1 blocked by a deny rule" in its summary,
  slow motion ends on "Blocked by a deny rule" with no failure flash, and the trace card's status reads Blocked.
- **What it never counts as:** `dropped` or `failed`, so live view shows it as its own neutral badge (never the red
  count or a failure flash), and Run simulations never reports it as a loss.
- **A denied route out of a broker isn't a consumer.** Its target leaves the consumer group's members (it takes no
  partition and isn't restricted by one) and the route bypasses the group's slot gate: it's always ready, even when the
  consumers are full or there are none, so a topic whose only route is denied blocks everything it gets and holds
  nothing. The no-reader check reads it as "Nobody reads", saying its only route out is a deny rule.
- **Capacity analysis** treats a denied route as an unbounded exit, the way playback does. A type a denied route in a
  group accepts never limits the broker (no false overload), each allowed route in that group takes its round-robin
  share at most its own capacity, and the rest is blocked at the broker. A gateway's or service's denied edge gets no
  demand. The capacity check, live view's heat map, its fix and the Inputs panel all read this one analysis.
- **Malformed values fail closed.** `isDenyRule` (src/stencils/netDevices.ts) reads anything set that isn't `false`
  as deny, everywhere a rule is read (playback, analysis, the canvas, the inspector, accessible names). Opening a file
  with a `deny` that isn't true or false sets it to `true` and warns: "it's read as deny, so what's routed there is
  blocked. Set it to false to allow."
- **Filters make it a rulebase line:** "Deny: branch → payments" with `filter: ["PaymentAdmin"]` blocks only that
  type.

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

## What playback shows going wrong

The plan (below) can't see everything: a node down, messages lost, a backlog that keeps growing.
`TroubleWatcher` (`src/live/observedTrouble.ts`) reads the run's real-unit snapshot on every publication (`useObservedTrouble`), so a status change shows at once,
paused or not. Changes to dropped counters also invalidate the trouble cache on every publication, including the final partial second of a completed run; lag trends are sampled about once a simulated second, 10 s kept, and a jump in time (a seek, a restart,
a stalled tab) starts them again. The topology it needs (routes into each node, dead-letter targets as playback
classifies them, deny rules left out) is indexed once per diagram. Worst first:

- **down**: a node (not a source or decorative) whose status is down. Revive. Behind brokers it says where its
  messages wait and how many so far, in the capacity callout's words.
- **dropping**: a node whose `dropped` grew over the window. Broker arrival losses while down are tracked in `outageDropped` (also in real units), independently of the bounded event log, and offer **Show events** after revival. Exhausted broker deliveries with no effective dead-letter route offer **Add dead-letter queue** (the same queue as the `dead-letter` check's fix, `deadLetterFor`); otherwise **Show events**. Effective dead-letter targets come from `deadLetterRoutes`, selecting the first route before deny handling. Diagnostic actions remain available in slow motion.
- **lag**: a broker whose largest group lag rose over the window by more than `max(10, 3 × scale, 20% of where it
was)`, and is still rising (the middle and latest samples). It names the group's consumers ("Billing doesn't keep
  up with it") with **Inputs…**; a queue nobody reads offers **Add a consumer**. Dead-letter queues are left out:
  they keep what they get on purpose.

The live view shows the worst one in the callout **on its own**, while editing in live view (never presenting,
recording, embedded or in the Lab), each cause once per run (a run is the engine's generation and simulation),
until it's dismissed or over. With the heat map on, it leads the capacity callout, unless that already says the same
with its own action (over capacity, nobody reads it). Over the 16 public examples it reports nothing in free play
but the IoT hub (which the plan calls over capacity too), and in saved stories only what they're about (an outage, a
throttle, a rebuild).

## Bounds

`SIM_LIMITS` (`src/model/simProps.ts`) is the file format's bound on every simulation setting, and every editor uses
it: rates up to **10,000,000 msg/s** (node `ratePerSec` and traffic profiles; live view samples them, so they cost
bounded work to play), counts (replicas, partitions, concurrency, max deliveries) up to 10,000, times up to 600,000 ms. The
inspector clamps to them and says so under the field; the Inputs panel takes the same rates. A file past one is refused
with the field and the limit ("ratePerSec 20,000,000 is over the 10,000,000 limit"). The document's traffic budget
(200,000) counts what plays: scripted messages × the Traffic multiplier ÷ the simulation's saved `scale`.

Continuous source traffic has a separate engine budget, including saved runs with explicit scale overrides:
all source rates combined, divided by the current scale, must be at most **10,000 sampled messages/s**.
An unsafe combination cannot enable Continuous traffic; its menu explains how to increase Messages per dot in
Inputs or lower source rates. The engine rechecks the bound before every tick, including after setup, timeline,
live prop or scale changes. The accepted file/UI rate remains 10,000,000 msg/s; automatic sampling safely
represents it. Sampling is never changed silently in the middle of a run.

Across a run, continuous sources emit at most **200,000 sampled messages total**. Fractions are retained per
source; a tick emits the integer credits only while that shared budget has room (about 100 dots/tick at the rate
ceiling, plus carried fractions across sources). Reaching the volume budget stops continuous input, logs the
reason and shows a notice in Live; restarting clears it, toggling does not. Checkpoints restore the budget with
the run. Thus an unread queue cannot accumulate unlimited continuous input. Scripted/manual traffic has its
own validation and is not charged to this source budget. Fan-out still copies admitted messages, so the budget
bounds source input, not the number of downstream copies in an arbitrary graph.

Travelling messages are scheduled in a stable min-heap by arrival time and particle ID. An idle tick inspects
only its earliest arrival, independently of burst size; due arrivals cost O(k log n) for k arrivals among n
travelling messages. A separate collection of at most `maxParticles` drawn trips bounds `frame()` work. Brokers
and sinks retain unlimited delivery throughput: the drawing cap never stages or discards messages.

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
  accepts parallel work at these roles, so this estimate is advisory rather than a throttle in playback. A network
  device's capacity is its throughput ceiling instead, which playback enforces (see "Network devices").
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
  timeline chaos/injections, retry/failure cost, jitter and broker storage/IO
  costs. Brokers accepting into another broker can buffer without a modeled ingest limit.
- Feedback demand iterates to a fixed point with 256 iterations and a 10¹² msgs/s per-type cap. Amplifying
  or unbounded cycles return `converged: false`; their numbers are capped estimates. Show that warning.

Use `utilization` for the heat map (guard Infinity), and `suggestion` for the callout. The most utilized
node is returned even below 100%; tied limits prefer the processor over its broker. Suggestions identify
idle replicas and partition increases, or a replica increase for an overloaded service. Analyze a copy
of the simulation with current live multipliers for an up-to-date panel; the analyzer has no engine state.

## Snapshot

`snapshot()` returns particles, per-node state (`backlog`, `lag` per group, `inFlight`, `processed`,
`failed`, `deadLettered`, `dropped`, `throughput`, and `noConsumer` on a broker nobody reads), per-edge counters,
recent events, and `inSystem`.

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
`deadletter`, `drop`, `block` (a deny rule stopped it), `park` (kept by a broker with no consumers, such as a DLQ) and `end`. A trace is
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

## Slow motion

A paced **replay** of one message's journey (and its fan-out copies), node by node, while live is
frozen. Code: `src/live/slowmo/` (pure: `script.ts`, `session.ts`, `sampler.ts`, `camera.ts`; drawing:
`painter.ts`; wiring: `useSlowMotion.ts`). Research and parameters: `docs/research/watchable-simulation.md`.

- **Record first, then replay.** `LiveController.lookAhead()` checkpoints the whole run (the runner's
  checkpoint in a saved simulation, the engine's in free play), the session asks the tracer for the
  message (`request` next at a node, `followRoot`, or what's followed now) and steps simulated time in
  slices (at most 2 s simulated or ~6 ms of work, then a browser frame) until the journey is done, at
  most **30 s** of simulated time ahead. Pausing notes pass as in `seek`, and the timeline's trace
  actions wait, so the tracer keeps the chosen message. Then the checkpoint is
  restored exactly and the tracer keeps following the same root, so after slow motion live shows the
  very journey that was replayed (runs are deterministic; a unit test compares the steps).
- **Nothing can arrive** (free play with no traffic and an empty system, a finished run): the session
  is _armed_. The live trace waits (the card offers **Send one now**) and slow motion starts once the
  message is on its way. A journey still under way at the cap plays what was recorded and ends on
  "Still waiting at Payments service · 1,240 waiting" (a topic: "· lag 1,240", a queue: "· 1,240 queued").
- **Live is frozen**, not just dimmed: the controller is held (`LiveController.hold`) from the look-ahead
  until slow motion ends, so play, step, continue and seek do nothing whichever control asks (live's own
  are disabled while it records ahead). The engine is paused, background dots are drawn at 12% with no
  trails, pulses or failure flashes, edges stop marching, off-path nodes, edges and badges step back.
  Leaving (Esc, the card's close) restores the play state from before and the view; the engine time is
  unchanged.
- **The script** (`buildScript`): every lineage step becomes a beat with its own wall duration; branches
  run in parallel and a beat starts when its message's previous one ends. Real timings only appear as
  text (captions, the trace card, the clock "0.43 s / 2.42 s real"). Pacing at 1× (the speed select
  scales the replay's clock):

  | Beat                          | Duration                                                           | Notes                                                                                                                                                          |
  | ----------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Establish (`emit`)            | 0.8 s                                                              | "Storefront sends OrderRequest"                                                                                                                                |
  | Hop (`send` → `arrive`)       | `clamp(L / 260 px/s, 0.9, 1.8)` s, L = on-screen edge length       | easeInOutCubic, 150 ms lift-off, 250 ms landing ring, 40 px trail; the edge brightens                                                                          |
  | Processing (`start` → `done`) | `clamp(0.55 + 0.22·log2(1 + ms/25), 0.6, 1.6)` s                   | a ring around the node fills linearly; "Payments service · Authorize payment · 150 ms → PaymentCompleted" (node, the incoming edge's words, real ms, a rename) |
  | Waiting (> 20 ms)             | `clamp(0.5 + 0.3·log2(1 + ms/100), 0.5, 2)` s                      | queued dots behind it; "waited 4.2 s"                                                                                                                          |
  | Append (broker)               | 0.45 s                                                             | "appended to orders.created.v1"                                                                                                                                |
  | Split (fan-out)               | 0.4 s                                                              | copies leave together on one shared duration (the longest); more than 4 leaving together: 4 are shown with "×6 OrderPlaced", the card says "+2 more"           |
  | Write (store)                 | processing + 0.3 s sink                                            | the dot shrinks into the store, its top edge flashes in the message colour                                                                                     |
  | Sync reply                    | 0.6 × hop                                                          | small, faint, never holds anything up                                                                                                                          |
  | Retry                         | full hops for the 1st and 2nd; later ones fold into one 1.2 s beat | amber; "↺ retried 3× over 0.74 s"                                                                                                                              |
  | Dead letter                   | 1.2 × hop                                                          | red; "Dead-lettered after 5 attempts"                                                                                                                          |
  | Drop                          | 0.6 s                                                              | "Dropped · consumer down"                                                                                                                                      |
  | End                           | 1.2 s hold                                                         | "Done · 2.42 s · 5 copies · 5 writes"; visited nodes keep their real offset ("+0.43 s")                                                                        |

  The Kafka order takes about 17 s and never moves more than 4 dots at once. With
  `prefers-reduced-motion` every beat is a still state held 1.5 s (a 200 ms cross-fade, no replies,
  no camera moves).

- **Captions** sit beside their node (or ride their dot), clear of node cards, badges, chrome and
  each other (`placeTraceLabels`). With no room there they try a shorter form, then just the real time,
  and the full words go to a short stack just above the live bar. The latest caption is also in a
  polite live region for screen readers.
- **Camera.** Fit the whole path once (keeping clear of the trace card's first rows, max zoom 1.25) and
  stay put. If that fit is below 55% zoom, follow instead at 80%: pan (700 ms) only while no dot is
  travelling, looking one hop ahead. Panning or zooming by hand stops following until Replay.
- **Controls**: Space plays or pauses, ← → step hop by hop (and pause), Restart replays, the timeline
  scrubs (a tick per hop), the trace card highlights the hop being told (`aria-current`) and a click on
  a hop plays from there, Esc goes back to live. **Record video…** offers one option, "Record this slow
  motion": it plays from the first beat and stops at its end (`<diagram>-<type>-slow-motion.webm`).

## Calmer slow speeds

Speed changes how fast dots move, not how many there are. Below 1× the renderer draws a sample of whole
journeys (`CalmSampler`, `src/live/slowmo/sampler.ts`): one family (a root and its copies) in
`k = 2^round(log2(max(1, dots / D)))`, with **D = 24** at 0.25× and **D = 48** at 0.5×. A family is in
or out by a hash of its root id, decided when it's first seen and kept until it leaves the screen, so a
sampled message is visible on every hop and nothing pops in or out mid-edge. k is re-planned at most
once a second, one doubling or halving per step with ±25% hysteresis (a new speed jumps straight to
the ideal k). The traced family, retries and dead letters are always drawn. At 1× and above nothing
changes; the per-edge density thinning stays as the fallback. It's a drawing limit only: counters,
badges, scale, capacity and recordings never see it.

P3 admission also accepts measured rates below one request per second: the local bucket can accumulate one request of credit. Live quota edits refill existing credit on simulation time before applying the new cap, without granting a fresh burst. Malformed admission data refuses requests instead of corrupting the simulation clock.

P3 review corrections: outage termination releases concurrency reservations; existing retained consumer retries charge a new attempt budget after backoff. These are consumer attempts, not item 10 caller retries. Live quota changes take effect at their edit time. Capacity uses targeted endpoint duration, skips zero-demand calls, and treats conflicting shared definitions as unusable. Upgrading an earlier diagram selects measured behaviour rather than introducing vendor quotas; selecting a vendor preset is a separate action.

## A1: resource execution and Kubernetes HPA (`p3-a1`)

A1 is an explicit model revision. New diagrams select it; existing diagrams offer a preview and an undoable
upgrade that materializes their existing workload. Upgrading never adds resource costs or a scaling policy.
Absent resources, the preceding simulation path, sampling and results remain unchanged. Native files, agent
operations, setup/timeline replacements, clipboard v2 and Interactive HTML preserve the new settings.

`resources` pins a workload lesson and revision, CPU-ms per real attempt, baseline plus per-in-flight MiB,
CPU/memory requests and limits, startup delay/jitter and termination grace. Requests are denominators, not
throttles. CPU execution intersects slot/latency capacity with the CPU limit (or explicit available-CPU
assumption); an absent CPU ceiling is unbounded, not an inferred request. Waiting and network travel consume
no service CPU. Retry attempts consume new CPU after backoff. Memory above its limit marks an unsafe run;
OOM, restart, GC, caches, queued payloads, sidecars and initialization CPU are not simulated.

For resource-enabled runs, a 10 ms boundary advances due readiness and previous work, integrates resource
windows, evaluates controllers in stable node order, reconciles the changed fleets and refreshes affected
P2 assignments, then injects/delivers/pulls new work. Authored timeline actions precede these boundaries.
CPU budgets last one quantum; unused CPU cannot accumulate. All controller state, weighted work, resource
integrals, cohorts, stable IDs and deadlines are checkpointed on simulation time. Pause freezes a node and
resume schedules one future sync, without replaying missed polls.

The HPA lesson explicitly assumes CPU 70%, min/initial 1, max 10, warm initial replicas, 5 s startup and a
15 s CPU window. Published defaults are sync 15 s, tolerance 10%, scale-up stabilization 0 with the larger
of +4 pods or +100% per rolling 15 s, scale-down stabilization 300 s with up to 100% per 15 s, and termination
grace 30 s. Readiness/initialization flags retain their documented 30/300 s defaults; startup CPU spikes are
excluded, not fabricated. These flags are not mandatory waits after a replica becomes ready. Source:
[Kubernetes HPA](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/).

The controller takes the largest CPU/memory Resource recommendation, or a ContainerResource bound to the
one explicitly named modelled container. Targets are percent of requests or absolute millicores/MiB.
Missing/unready samples inhibit shrink; valid metrics can still grow. Recommendations use rolling
stabilization history and actual changes within rolling rate-policy periods, then min/max clamping.
An authored `replicas` action suspends the controller until `resumeAutoscaling: true`. Capacity × scales
initial/min/max once; Save pins that effective range. It does not multiply CPU costs or targets.

Increasing desired count creates starting replicas with no slots until their seeded readiness deadline.
Scale-down removes empty IDs first, then drains occupied IDs in descending order. Draining replicas accept
no new work, retain CPU and memory until work completes, and use existing failure/redelivery rules once
at grace expiry. An increase starts replacements instead of reviving terminating IDs. Log partitions stay
reserved during drain; surplus ready readers remain idle and still contribute baseline memory and idle CPU.
P3 native managed/serverless allocation remains the sole owner on those profiles: HPA is unavailable there.

Idle/starting replicas use counted ranges; exact busy identities expand only at sampling scale 1. Sampled
attempts distribute their real CPU work across eligible homogeneous ranges and retain occupied ranges during
drain. Per-replica sampled values are labelled estimates. Memory uses time-integrated occupancy credits,
rather than placing a giant dot on one replica. History is bounded to 600 points, metrics to 600 one-second
buckets, and the selected inspector requests at most 50 replica rows. Idle ticks do not visit every replica.
Metric window plus delivery delay must fit the 600,000 ms history budget. Jittered ready ranges compact
without merging active sampled CPU boundaries. Frames reuse detached, frozen history between publications.
The native reader and engine preflight reject configurations whose worst authored fleet ranges exceed
100,000 total lifecycle replicas (including scenario Capacity × and the free-play slider's range); each
effective fleet remains capped at 10,000. Budget failures reject the run rather than simulating a partial fleet.

Checks and configured analysis share CPU-limited capacity and resource feasibility arithmetic with the
inspector. Estimates distinguish initial and maximum capacity before partitions/quotas and show required
replicas, maximum reached, baseline-memory targets that cannot be fixed with replicas, and peak-memory risk.
Live capacity follows ready replicas; playback explains its observed metric, raw recommendation, bounded
desired count, reason and next sync. These steady-state estimates are not verified burst guarantees.
KEDA activation and local broker metrics are described below. Generic external metrics, multi-container
accounting and provider adapters remain unsupported; scenario cloud sizing and verified automatic policy edits remain A3.

## A2: KEDA activation and Kubernetes import

A KEDA ScaledObject is a node-owned `autoscaling` policy with `modelRevision: "a2"` and
`controller.kind: "keda"`, within the existing explicit `p3-a1` document revision. Older readers reject
the new controller/revision union instead of silently playing it as HPA. A1 and resource-less diagrams
retain their existing execution path and arithmetic. Imported and newly opted-in resources carry their own `modelRevision: "a2"`,
which enables generic Kubernetes Deployment resources independently of the controller. Selecting Fixed or
disabling scaling retains CPU limits, memory and lifecycle. Older unmarked A1 Deployment resources retain
their previous unsupported behavior. Imported HPA policies also carry the A2 controller revision. Resources and autoscaling remain atomic replacement
properties in native, agent, setup and timeline patches.

The pinned profile is KEDA 2.18, not a claim about the newest KEDA release. Its defaults are 30 s polling,
300 s final-zero cooldown, no initial cooldown, min/initial 0 and max 100; the generated HPA retains A1's
15 s sync, tolerance, rolling stabilization and policies. The supported triggers are:

| Trigger            | Local real-message metric                                                             | Default target / activation |
| ------------------ | ------------------------------------------------------------------------------------- | --------------------------- |
| `kafka`            | Named group's pending plus outstanding, uncommitted deliveries across its partitions  | 10 / 0                      |
| `azure-servicebus` | Active waiting messages in one queue or exact topic subscription, excluding DLQ       | 5 / 0                       |
| `aws-sqs-queue`    | Waiting plus outstanding once by default; `scaleOnInFlight` can exclude outstanding   | 5 / 0                       |
| `rabbitmq`         | AMQP waiting messages; HTTP optionally includes unacknowledged/outstanding deliveries | Lesson 20 / 0               |

Modern RabbitMQ QueueLength imports require an explicit `value`; the old `queueLength` default is 20.
The lesson's 20 is an assumption. Delayed SQS visibility, RabbitMQ rate/regex modes, experimental
`apache-kafka`, unspecified Kafka topics/history and generic metric-server queries are unsupported.
An imported Kafka trigger needs one declared local topic with known partitions; its simulated history
begins with the authored empty log. No live cluster or real offsets are read.

Activation is strictly `metric > activation`. At zero, only a due KEDA poll can request the activation
floor `max(1, min)`. Starting replicas have no slots until A1 readiness. Subsequent changes are made by
one generated-HPA evaluation, with the largest trigger/resource recommendation; KEDA never separately
applies a second 1→N count. Its activation delta does not consume HPA's rolling rate-policy budget.
Activation thresholds do not gate 1→N while the minimum is positive. Each trigger can independently cache
its metric until the next KEDA poll; an uncached HPA sync reads the current indexed counter.

When every trigger is inactive, an eligible zero transition runs before the HPA branch, after the
initial guard while the fleet has never been active, then cooldown since the last active poll (the
pinned 2.18 executor switches between these clocks). Initial warm fleets with no activation history
use the initial guard; there is no fabricated last activity. Final zero is independent of HPA downscale
stabilization, rather than a universal sum of their defaults. An optional `idleReplicas: 0` can idle a
positive-minimum policy; the active HPA branch still clamps to at least one. Unknown/error metrics are
never zero: they inhibit unsafe shrink and cannot wake a sleeping fleet. Other valid metrics may grow.
Fallback is per trigger and begins when consecutive failed source reads **exceed** `failureThreshold`,
matching the pinned 2.18 implementation. Static/current/current-if-higher/current-if-lower fallback
feeds the same HPA pipeline, so stabilization and bounds still apply. A cached HPA lookup does not count
as another failed source read. A good source read resets failures. Fallback does not invent activation
from an unavailable zero-wake source.

Kafka caps its own recommendation at topic partitions unless `allowIdleConsumers` is true. This is
independent of P2 assignment: eight ready workers on a three-partition input still have three assigned
and five idle there. HTTP, queues or other subscriptions can use spare replicas in the shared fleet.
No keys, hot partitions, rebalance delay or new delivery/retry policy are introduced.

Broker metric lookup uses a compiled broker/group index and real-unit pending/outstanding counters,
never a message/partition/particle scan. Each due evaluation reads at most sixteen triggers plus resource
metrics; idle ticks inspect deadlines only. Sampling applies `scale` once. At a measurement boundary,
input quantization is less than one represented message; use scale 1 for exact activation thresholds.
KEDA poll state, cached validity, failure counts and last activity are checkpointed with A1 state.
Pause shifts lifecycle/activity clocks and schedules future polls on resume, with no missed-poll replay.
Fixed overrides, scaler disable/re-enable and Capacity × retain A1 ownership rules; zero floors stay zero.
Only successfully reconciled HPA changes enter its policy history; a refused zero proposal retains history.

The shared resource validator checks schema, complete node settings, document budget and broker/group
references at native/editor/import/agent boundaries. Clipboard fragments keep external references for
validation against the destination; copied broker IDs, implicit edge groups and inferred consumer groups
are remapped after ID allocation in linear graph work. A label is never a binding identity. Topology edits
preflight the complete candidate, including saved-simulation policies; an edit that would break a source
is refused with recovery guidance. Change or disable the affected policy before deleting its source.
Binding validation and playback share inferred dead-letter classification.

Kubernetes import resolves exact namespace, kind and API version. It maps single-container CPU/memory
requests and limits (decimal and binary quantities stay distinct), resource/ContainerResource HPA targets,
min/max/initial counts, behavior and KEDA timing/activation/cache/fallback settings. Limit-derived requests
are marked with `resources.requestDefaults`. Workload costs are **unmeasured**, not inferred from limits:
CPU/memory readings remain unknown until the person explicitly chooses the Advanced workload lesson.
That action preserves imported denominators, lifecycle and policy. The imported desired range remains
separate from the Deployment's authored starting-count metadata; imported status is never live state.

An HPA owned by its ScaledObject is linked rather than executed twice. Independent controllers targeting
one workload become unsupported, retaining up to sixteen safe kind/range summaries plus an omitted count.
Unsupported fields disable the whole policy and produce translated recovery diagnostics. ScaledJob keeps
its finite-job identity/topology with “Job execution is not simulated”; it never becomes a Deployment HPA.
Authentication objects/values, raw manifests, executable queries and credential-bearing URLs are absent
from persisted policy summaries. Existing YAML resource/alias/depth/document budgets apply, with additional
sixteen-trigger/eight-policy/controller-time bounds before execution.

Configured analysis and checks expose the same polling backlog estimate: at zero, rate × polling interval
arrives before the first poll, plus the separately disclosed startup delay. This is a configured estimate,
not an A3 burst planner or a throughput guarantee. Playback Why reports the actual real metric, activation,
raw recommendation, bounded desired count, reason and next deadline. The existing inspector retains four
main fields (preset, target, min, max); source choice, activation, polling, cooldown, resource assumptions
and complete controller JSON stay in Advanced. No scaler node or global control is added.

`keda-render-workers` is the public Autoscaling showcase: a synthetic poster-rendering burst wakes an
idle Kafka consumer and returns it to zero within ten simulated seconds. Its explicitly shortened
1 s polling/sync/startup and 2 s cooldown teach the phases rather than claiming vendor defaults.
Three frozen `a2-*` corpus diagrams pin activation, published cooldown and idle-reader behavior.
The seeded per-step ownership oracle includes KEDA zero activation, strict threshold edges, cooldown,
lag bursts, pause/resume, policy refusal and scaler disable/re-enable. It also checks nonnegative broker
pending/outstanding counts, desired bounds and successful zero-transition eligibility. Deliberate regression
controls cover metric adapters, partition gates, clocks, fallback, imports, editing and UI truth.
Successful cached metrics stay fixed between KEDA polls, independently of uncached triggers. The inspector
keeps its validator cache and avoids graph snapshots for Fixed/HPA; a refused pending source remains visible
with an accessible explanation, while an accepted binding focuses the surviving Target field.

Sources: [ScaledObject specification](https://keda.sh/docs/2.18/reference/scaledobject-spec/),
[Kafka scaler](https://keda.sh/docs/2.18/scalers/apache-kafka/),
[pinned fallback implementation](https://github.com/kedacore/keda/blob/v2.18.0/pkg/fallback/fallback.go).

## A3: cloud scaler adapters and scenario sizing

A3 adds four executable cloud policies under `autoscaling.modelRevision: "a3"`, still inside the explicit
`p3-a1` document revision: `controller.kind` is `ecs`, `aca`, `appService` or `cloudRun`. Older readers refuse
the new union, as they refuse A2. Each adapter is a thin policy over the shared A1/A2 fleet: startup, readiness,
drain, pause/resume, fixed override and resume, Capacity ×, checkpoints and the one reconciliation path are
unchanged, and every adapter writes the same decision record (with `adapter`, `metricKind`, `policy` and alarm
`periods`). Legacy, A1 and A2 diagrams play exactly as before. Official values below were checked on 2026-10-15;
values marked **assumption** are explicit lesson choices, never vendor guarantees. Presets use the shared I/O
workload lesson (40 CPU-ms per message, 500m/1,000m CPU, 256/512 MiB) as before: measure your service.

| Adapter                        | Reads (real units)                                                                                                                                                                    | Executes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Preset defaults                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS ECS target tracking        | Task CPU/memory as a percent of the task size (`resources.cpuLimitMilli` / `memoryLimitMiB`), or ALB requests per running task per minute                                             | One evaluation per CloudWatch metric period. Proportional: out to `ceil(running × metric / target)` (the metric averages the running tasks), in to `ceil(desired × metric / target)`. Scale out when any policy asks (largest), in only when every scale-in-enabled policy agrees. Tasks still starting count in the desired count a scale-out must exceed, so a cooldown never adds them twice and a larger scale-out passes; the scale-in cooldown blocks shrink until a scale-out interrupts it. Missing data never scales in; a per-task metric can't wake zero. | Target 70% CPU or 1,000 requests/target/min (assumption), cooldowns 300 s (documented ECS default), period 60 s; alarm windows 3 periods out, 15 in below 90% of target (**assumption**) |
| AWS ECS step scaling           | The same metrics, or the load balancer's total requests per minute                                                                                                                    | A CloudWatch alarm (operator, threshold, consecutive evaluation periods) invokes its policy every period while in ALARM. Step bounds relative to the threshold: lower inclusive and upper exclusive above it, the reverse below. ChangeInCapacity, ExactCapacity and PercentChangeInCapacity with AWS's rounding and `minAdjustmentMagnitude`. Total requests can wake zero.                                                                                                                                                                                         | Out at ≥ 70% CPU for 3 periods (+1, +3 from 85%), in at ≤ 30% for 15 periods (−1) (**assumption**); cooldown 300 s (documented default)                                                  |
| Azure Container Apps           | HTTP: requests that arrived in the past 15 s ÷ 15 (documented); event rules: A2 KEDA broker triggers                                                                                  | The A2 KEDA/HPA pipeline with ACA's documented behaviour: HTTP read on every 15 s sync, an HTTP request wakes a sleeping app on demand, event rules activate on their own poll, final-zero cooldown, scale-up `max(4, 2 × current)` (+3 or +100% per 15 s reproduces 1→4→8→16), scale-down stabilization 300 s removing 100%.                                                                                                                                                                                                                                        | Min 0, max 10, HTTP 10, polling 30 s, cooldown 300 s (all documented)                                                                                                                    |
| Azure App Service (Monitor)    | CpuPercentage / MemoryPercentage of the instance size, HttpQueueLength per instance, averaged over each rule's window                                                                 | Each evaluation: any triggered scale-out rule (highest capacity); otherwise scale in only if every scale-in rule triggers (fewest removed), deferring or reducing a scale-in that would trigger a scale-out (flapping). Each rule's cooldown counts from the most recent scale action. An unreadable metric restores the default capacity and never scales in.                                                                                                                                                                                                       | Evaluation 60 s (documented "30 to 60 s", so an **assumption**), > 70% / < 30% CPU over 5 min, ±1 (**assumption**), cooldown 5 min                                                       |
| Google Cloud Run (approximate) | Per-instance concurrency as a percent of the node's own Concurrency (the container's maximum), the higher of a short and a long average; CPU as a percent of the instance's CPU limit | The HPA pipeline with Cloud Run's documented 60% targets and 10% relative tolerance, no scale-out rate limit, and on-demand scaling: waiting requests start `ceil(demand / concurrency)` instances when none can take them. Scale-in after idle retention.                                                                                                                                                                                                                                                                                                           | Min 0, revision max 100, concurrency 80, targets 60%, CPU 1-min and concurrency 1/10-min windows (documented); 10 s cadence and 60 s idle retention are **assumptions (UNVERIFIED)**     |

Simplifications, also stated in the inspector: ALB request counts are the simulated load balancer's routed
requests (a request flow from an Elastic Load Balancing node), never a service's message input. Cloud Run's
pending-request timeout (429 after 10 s or 3.5× the cold start), adaptive concurrency, idle-instance
deprioritisation and maximum-instance overshoot are not simulated. ACA revisions, TCP rules and traffic splits,
App Service shared plans, scheduled profiles and automatic (traffic-based) scaling, ECS predictive and
custom-metric scaling, metric math and CloudWatch missing-data treatments other than "insufficient data" are
unsupported. Cloud Run's pinned concurrency is the node's Concurrency, edited as its main target field.

Metric windows reuse the fleet's 1 s buckets: two more time integrals (in-flight work, waiting pushed requests)
and an O(1) counter of pushed arrivals. Waiting pushed requests are the node's queue minus the deliveries holding
a group slot there (every queued delivery holds one; the invariant oracle checks it), so no queue is scanned. An
ECS period reads one cumulative routed count per load balancer. Per-tick work stays bounded by groups and work in
service, never by replicas or queued messages.

### Scenario sizing (planner)

`src/sim/scalingPlanner.ts` plays each saved simulation headless with the same engine, seed and controllers as
playback, samples every scaler once per simulated second, and suggests one change per scaled node:

- **max**: at steady state at the maximum (the whole fleet ready for the decision's metric window, no backlog
  draining) the scaler wanted more: its unclamped recommendation or, for rule and step controllers, the
  proportional count `ceil(ready × metric / target)`. The research example reproduces exactly: at 3× traffic,
  HPA max 10 at 92% of request with a 70% target suggests max 14.
- **partitions**: raising the maximum doesn't drain the backlog because an input's partitions bound the useful
  readers (or KEDA reported its partition cap): raise the partitions, and the maximum to read them.
- **quota**: an admission quota still refuses as much with more replicas: no replica fix is offered.
- **target**: the backlog grew while the scaler held its count below the maximum with its metric under target
  (a slot-bound service whose CPU never reaches its rule): lower the target.
- **min**: only when one of the simulation's own backlog, lag or in-flight goals (expectations) fails while
  replicas start: keep what the scaler wanted then warm.

Every suggestion is verified by one rerun with all suggestions applied, same seed: a fix is offered only when the
rerun bears it out (the end backlog falls, the scaler leaves its maximum, the goal passes). Target and minimum
suggestions that aren't borne out are dropped. Startup backlog stays visible in the words even when steady-state
capacity suffices. A simulation that sets its own policy for a node is skipped for that node.

Bounds: at most 4 runs per simulation (the scenario plus up to three verify/refine reruns, shared by all its
scalers), 8 simulations, 600 s simulated per run, a work estimate (runs × ticks × diagram elements ≤ 60,000,000)
checked before any engine exists, and a start-work bound: the sampled messages each simulation sends, each times
what one arrival can become downstream (every copy, compounded through every stage), at most 10,000,000. While
runs play, one shared budget of 1,000,000 sampled messages (sent and copied, all runs of a diagram together)
catches what the estimate can't see, such as a copying cycle: the engine refuses the message before creating it.
A verification rerun whose fixes would take the diagram past its lifecycle budget isn't played. Over any budget
the plan is **unavailable** with its reason, never partial, and the other checks still run. Results are memoized
on what a simulation sees (`src/sim/simulationContent.ts`: node ids, stencils, labels, subtitles and props;
connection ends, kinds, relationships and props; the simulations), so moving things or renaming a connection
reuses them and renaming a node doesn't. Scalers and their distinct input groups are found from one index of the
connections. Operation counts prove that eight times as many scalers cost no more runs or ticks, and eight times
as many scalers and connections no more than linear work to find them.

In the editor, planning runs only in the checks worker: no simulation plays on the UI thread. The background
check returns its plans with its result, and the editor remembers the worker's results by simulation content
(`src/lib/scenarioPlanner.ts`). `describe_diagram` and `check_diagram` wait for the worker's plan, a fix is
re-checked against the plans its finding came from, and Copy prompt includes sizing once the worker has worked it
out. Headless tools and tests plan where they're called.

The same result appears in three places: Checks (the capacity rule's scenario sizing finding, with one undoable
fix replacing the complete policy, or partitions and maximum together), agent analysis (`describe_diagram`
lists `scalingPlans` with English explanations; `check_diagram` returns the finding) and live playback (the
selected node's Live details show the planner's sentence for the saved simulation playing, computed by the same
memoized function in the checks worker). Live Why also shows the adapter's own reason, metric and alarm periods.

### Validation, editing and bounds

Bindings (ECS load balancers, ACA event sources) go through the one shared resource validator at every node
creation path (add, named, rail, connected, insert, paste, duplicate), every edit path (graph, stencil, relation,
reversal, reconnection, saved simulations), native reads, imports, agent operations and templates. An edit that
would break a binding is refused atomically; connection label edits are never dropped. Policies are bounded:
at most 8 target-tracking and 8 step policies, each with at most 8 steps (no overlap or gap, one open end per side,
covering the breached side), 10 Monitor rules and 16 ACA rules, the A1 time and count bounds, and Cloud Run
percent targets of 1–100. The seeded invariant oracle adds per-adapter cases (scale to zero for ACA and Cloud Run,
ECS step edges, App Service cooldowns, pause/resume, refusals, disabling mid-run, fixed override and resume). It
checks that ECS never scales in on missing data or inside its scale-in cooldown, a Monitor rule never acts inside
its cooldown or against its direction, request wakes come only from request scalers, and every queued delivery
holds its group slot. A resumed controller owns the count from its first evaluation; an override above the
maximum stands until then.

### Terraform import

Only Terraform (`terraform show -json` plans and state) already reads these services, so only Terraform maps
their scaling (`src/interop/infra/tfScaling.ts`). Each policy attaches to exactly one drawn node; values are
validated before use and the result passes the shared schema, or the policy is imported as `unsupported` with a
reason category, keeping the drawn topology. Unknown non-empty fields in a mapped block are reported, never
dropped. No secret, authentication value, URL or connection-string name is read into the diagram.

| Terraform input                                                                                       | Imported as                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aws_appautoscaling_target` (ECS desired count), joined by reference or `service/<cluster>/<service>` | ECS range: `min_capacity`/`max_capacity`; initial is the service's `desired_count` clamped to the range                                                              |
| `aws_appautoscaling_policy` target tracking: ECS CPU, memory, `ALBRequestCountPerTarget`              | Target-tracking policies; ALB metrics bind the drawn load balancer that routes to the service; cooldowns in ms (unset: 300 s); `disable_scale_in`                    |
| Step scaling with the `aws_cloudwatch_metric_alarm`s that invoke it                                   | Step policies: AWS/ECS CPU and memory (Average) or ALB `RequestCount` / `RequestCountPerTarget` (Sum over 60 s); threshold, operator, periods, steps, type, cooldown |
| `aws_ecs_task_definition` `cpu` / `memory`                                                            | Task size as CPU and memory limits (1,024 units = 1 vCPU), with unmeasured workload costs until a lesson is chosen                                                   |
| `azurerm_container_app` `template`                                                                    | Container Apps range, cooldown and polling, one HTTP rule, Service Bus queue or topic-subscription rules bound to drawn entities; first container's size             |
| `azurerm_monitor_autoscale_setting` on a plan hosting exactly one drawn web app                       | App Service capacity (default/min/max) and CpuPercentage, MemoryPercentage, HttpQueueLength rules with windows, actions and cooldowns                                |
| `google_cloud_run_v2_service` `template.scaling`; `google_cloud_run_service` Knative annotations      | Cloud Run range (unset maximum: 100), per-instance concurrency as the node's Concurrency (≤ 1,000), CPU and memory limits                                            |

Gaps, each reported with its reason: ECS customized metrics, predictive and scheduled scaling, step policies
whose alarm isn't in the files, metric math, M-of-N alarms and other missing-data treatments, policies with
different periods; Container Apps TCP, Azure Storage queue and other custom rule types, more than one HTTP rule,
multi-container apps; App Service shared plans (capacity ownership is ambiguous), recurrence or fixed-date
profiles, `divide_by_instance_count`, statistics other than Average and Functions plans; Cloud Run service-level
or manual scaling, other Knative annotations and sidecars; any sensitive scaling attribute. Not read at all:
Bicep/ARM, CloudFormation/SAM, CDK, Pulumi, Terraform HCL source, VM scale sets and auto scaling groups, and Lambda
or Functions concurrency (P3 owns those). Hostile inputs are bounded by fixed caps; tests prove that 100,000-item
collections and deep nesting are never walked and that 8× more services cost linear work.

`cloud-run-timetable-api` is the public Autoscaling showcase: an invented commuter timetable API sleeps overnight,
wakes on demand, hits its maximum of 6 in the morning rush (Check diagram suggests 11, verified) and returns to
zero. Its shortened timings are labelled teaching assumptions. Ten frozen `a3-*` corpus diagrams pin each adapter
and the planner's max, target, partitions and quota cases.

Sources: [ECS target tracking](https://docs.aws.amazon.com/autoscaling/application/userguide/target-tracking-scaling-policy-overview.html),
[ECS step scaling](https://docs.aws.amazon.com/autoscaling/application/userguide/step-scaling-policy-overview.html),
[Container Apps scaling](https://learn.microsoft.com/azure/container-apps/scale-app),
[Azure Monitor autoscale settings](https://learn.microsoft.com/azure/azure-monitor/autoscale/autoscale-understanding-settings),
[flapping](https://learn.microsoft.com/azure/azure-monitor/autoscale/autoscale-flapping),
[Cloud Run autoscaling](https://docs.cloud.google.com/run/docs/about-instance-autoscaling),
[concurrency](https://docs.cloud.google.com/run/docs/about-concurrency),
[maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances).
