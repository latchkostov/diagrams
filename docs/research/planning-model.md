# Planning model: realistic settings, capabilities, external APIs and built-in education

Status: completed research proposal, checked 2026-10-14. Docs only; nothing here is implemented or newly approved.
Branch `research/planning-model`, based on `d420d98`. The inherited screenshots in `docs/research/planning-model/`
were visually reviewed for this completion. The interrupted draft reported a production build and Playwright capture
on port 6031; that capture procedure was not repeated. They show a constructed review diagram
(Checkout → F5 BIG-IP → Orders → Stripe, orders-db, a Kafka topic, Notifications → Iterable). The fully written
education entries that set the bar are in [`stencil-education-sample.md`](stencil-education-sample.md).

The owner's request:

> Make a very realistic simulation, to the point where every stencil has its typical configurations or settings,
> obviously not overburdened. For Kafka topics we have partitions; for consumers, services with replicas. Should we
> assume all services are consumers, or be more specific, so any service can be made a Kafka consumer? […] We'd
> configure all these things and have it be a real simulation and planning tool, so you could put e.g. Iterable up
> front.
>
> I don't see a general stencil for an external API […]. It should be under clients. […] drag in an API and optionally
> configure some endpoints on it (not required), and have one module call another by means of that endpoint.
>
> […] an educational module for each stencil: in the property sheet, or when you highlight it. It should understand
> how it interacts with other stencils. […] When you highlight the service, it should say: this service can only
> process 1 request/s, incoming from the other service. The suggestion would be to make it faster, or add a replica
> behind a load balancer.
>
> People who don't know e.g. F5 BIG-IP, what a pool is, health checks: they should be able to hover these and maybe
> follow one link to an overview page on the vendor's site that isn't overwhelming.

This builds on [`sim-flows-review.md`](sim-flows-review.md) (items 1–6 being built in `feat/sim-truth-batch1`, 7–9
approved, 10 not approved), [`network-infrastructure.md`](network-infrastructure.md) (the size-preset pattern this
plan generalises), [`architecture-checks.md`](architecture-checks.md) (the shared planner and fixes) and
[`diagram-semantics.md`](diagram-semantics.md) (relationships). It doesn't repeat their findings.

## Summary

**The model in one paragraph.** Keep the nine simulation roles: they're the engine's contract and they're right. Add
two layers on top, both pure data and both optional in files:

1. A **profile** per stencil family (a broker kind, serverless, a SQL database, an external API…) that says which 2–5
   settings matter, their defaults, ranges and units, and offers **presets** with cited vendor numbers, the way the
   network devices' size presets already work (`src/stencils/netDevices.ts`). `resolveProps` already takes the
   stencil id (`src/sim/defaults.ts:41-46`); profiles slot in there, so every reader (playback, analysis, checks,
   live view) sees the same numbers.
2. **Capabilities** a node gets from its connections. A service isn't "a consumer" by type: it **becomes** a consumer
   when it reads from a topic or queue, a **caller** when it makes a Request, a **producer** when it publishes. Each
   capability brings its own few settings, which live **on the connection** (the relationship they describe) and are
   shown on the node in the inspector, one row per connection.

Then two things that make it a planning tool rather than a toy: **contextual explanations** (each node says, with its
numbers, what it's doing in this diagram and what would fix it) and **education** (what the thing is, its key concepts
and one good link).

**Answers to the owner's questions.**

- **Are all services consumers?** No; avoid a permanent consumer flag on the service stencil. Any processor reading from a broker is
  a consumer of it, through that connection, and only through it. The consumer's settings (group, parallelism, retry
  mode) sit on that connection, so one service can read two topics in two groups with different settings, and a
  service that only serves HTTP never shows consumer settings. This matches how the engine already works: the
  consumer group is on the edge (`EdgeSimProps.group`, `src/sim/types.ts:168-169`). See "Roles and capabilities".
- **External API.** It exists (`generic.external-api`, `src/stencils/catalog.ts:1813`), but in the **Generic**
  category, which is last in the rail and folded on a first visit, while Stripe, Twilio, OpenAI and the rest are under
  **Clients**. Move it, the generic email, SMS, push and marketing stencils, and the new vendors into Clients, renamed
  **Clients & external**. Add first-class stencils for Iterable, Braze, Segment, Shopify, PayPal and Adyen,
  each with a scoped, cited profile. Vendor latency is an assumption until measured.
- **Endpoints.** Optional, on any API node (external or your own service): a short list such as
  `POST /v1/payment_intents`, each with latency, a rate limit, an error rate and a response size, all optional. A Request can
  target one endpoint; the edge label shows it, and the simulation and the capacity analysis use that endpoint's
  numbers. Propose local OpenAPI import. Keep `diagrams/v1` for additive fields, but persist a simulation model
  revision and warn older readers: preserving JSON is not preserving playback semantics.
- **Education.** Coverage for all 204 stencils through family entries and product overrides: two or three
  sentences, 3–6 key concepts, how it connects, what to watch for, and one curated
  link. It shows in an **About** section in the inspector, the node hover card (edit mode) and the stencil drawer. It's
  lazy-loaded per family (full prose excluded from startup chunks). Both prose and UI use translation keys;
  the requested i18n foundation is absent from this checkout and must land before implementation.
- **Contextual explanations** are the most valuable part, and they come first. A pure `explainNode` reads the existing
  capacity analysis (and, live, the observed trouble watcher being built in `feat/sim-truth-batch1`), and says:
  "Orders handles about 1 req/s (1 replica × concurrency 4 / 4 s) but receives 3 req/s from Checkout through F5.
  Its waiting work grows by about 2 req/s. Three replicas would merely match demand; use 6 for 50% utilisation,
  or reduce processing time to about 0.67 s at that target." The callout keeps the system headline and its one
  **Apply fix**; the explanation is per node, in the
  hover card and the inspector, and it never repeats the headline.

**Top planning features, by value for effort:** (1) the explanations; (2) a required-size readout per node ("needs 6
replicas at 3 req/s"), extended to connections, partitions, serverless concurrency and vendor rate limits; (3)
**Headroom** ("breaks first at 2.4× today's traffic: Orders"); (4) scenario **Compare**; (5) an end-to-end **latency budget** on the request
path (an unloaded estimate now, observed p50/p95 once requests wait, sim-flows item 10);
(6) growth projections. Dollar cost is last: prices are regional and drift; show the cost drivers (requests, GB-seconds, units)
instead.

**Batches.** P1 is the common layer: profiles, capability readout and explanations, with no new stencils. P2 is
broker kinds (item 7); P3 is managed compute/external admission (item 8); P4 is delivery semantics (item 9).
P5–P7 add external discovery/vendors, optional endpoints and local OpenAPI import. P8 starts education with the
ten samples, followed by family coverage and planning reports. Item 10 remains a separate approval gate for
caller waits, propagated failures, timeout/retry enforcement and meaningful p95 under load. See "Phasing".

## 1. Today's model and its gaps

### 1.1 What the simulation models per role

From `src/sim/defaults.ts:41-89`, `src/canvas/Inspector.tsx:82-184`, `docs/SIMULATION.md` and the in-flight
`src/canvas/simFieldRules.ts` (`feat/sim-truth-batch1`, which hides the fields that change nothing):

| Role        | What it does                                                                                  | Settings in the inspector (after batch 1)                                   | Defaults                                         | Not modelled                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `source`    | Emits at a steady rate; a copy on every edge                                                  | Rate, Message type                                                          | 2 msg/s                                          | Shapes other than steady in free play (saved simulations have ramps, spikes, bursts), schedules  |
| `processor` | Waits for a slot, takes `latencyMs`, may fail; a copy on every edge                           | Replicas, Latency, Concurrency, Failure rate, Emits                         | 1 × 4 at 250 ms (16/s)                           | Autoscaling, cold starts, per-request CPU, timeouts, a caller waiting for its reply (item 10)    |
| `gateway`   | Adds latency, round-robins across routes; no concurrency limit                                | Latency; network devices: Size, Throughput, HA, Health checks, Message size | 60 ms, unlimited; devices from their size preset | Rate limits (429), algorithms, health-check detection time, caching (CDN), timeouts              |
| `store`     | Writes after `latencyMs`, unlimited parallelism; replies to Requests; async edges out are CDC | Latency                                                                     | 40 ms, unlimited                                 | Connections, throughput units (RU/s, WCU), throttling, cache hit rate, per-prefix limits         |
| `sink`      | Finishes on arrival                                                                           | none                                                                        | instant                                          | Latency, rate limits, errors: everything an external API does (F-12)                             |
| `topic`     | Every consumer group gets every message; ≤ `partitions` active replicas per group             | Partitions, Max deliveries                                                  | 3 partitions, 3 deliveries                       | Push pub/sub without partitions (item 7), ingest limits, retention, per-broker failure rules (9) |
| `stream`    | Same as `topic`                                                                               | Partitions, Max deliveries                                                  | same                                             | Same, plus shards' MB/s                                                                          |
| `queue`     | Competing consumers                                                                           | Max deliveries                                                              | 3 deliveries, requeue                            | Visibility timeout, built-in DLQ, FIFO groups, throughput caps                                   |
| `none`      | Passes through with no latency                                                                | none                                                                        | —                                                | —                                                                                                |

Edges carry `group`, `share`, `dlq`, `travelMs`, `filter`, `emits` and `deny` (`src/sim/types.ts:167-184`), and a
kind (Message or Request). Hidden engine knobs: `jitter`, `retry` (requeue or in place) and `retryBackoffMs`, reached
through Custom properties or the Inputs panel's Advanced.

### 1.2 The stencils

The catalogue has **204** stencils, not 250 (counted from `catalog` with a script). By category and role:

| Category          | Count | Roles                                                                                                                                                                                                  |
| ----------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Messaging         |    26 | topic 10 (Kafka Topic, SB Topic, Event Grid, RabbitMQ Exchange, SNS, EventBridge, Pub/Sub, NATS, Pulsar, MQTT), queue 5, stream 5, processor 3 (Connect, ksqlDB, Streams), source 1 (Debezium), none 2 |
| Compute           |    31 | processor 28 (services, functions, containers, orchestrators, Flink, Dataflow, Temporal, Camunda…), gateway 2 (SignalR, GraphQL), source 1 (Airflow)                                                   |
| Data              |    37 | store 30, processor 5 (Data Factory, dbt, Airbyte, Snowpipe, Reverse ETL), sink 2 (Looker, Tableau)                                                                                                    |
| Network           |    20 | gateway 20 (API gateways, LBs, proxies, meshes, CDN, DNS, Firewall / WAF, Route 53, Traffic Manager)                                                                                                   |
| On-prem network   |    19 | gateway 19 (routers, switches, NGFWs, ADCs; all with size presets)                                                                                                                                     |
| Observability     |    12 | sink 11, processor 1 (OpenTelemetry)                                                                                                                                                                   |
| Security & config |    15 | none 15 (dependencies: config, secret, identity)                                                                                                                                                       |
| Clients           |    15 | source 6 (User, Browser, Mobile, IoT, Team, GitHub), sink 7 (Partner, Stripe, Twilio, SendGrid, Salesforce, HubSpot, Slack), processor 2 (OpenAI, Claude)                                              |
| Generic           |    29 | processor 7, store 6, sink 5 (Email, Push, SMS, **External API**, Marketing Automation), source 5, none 3, queue 1, topic 1, stream 1                                                                  |

How a stencil gets its behaviour today: one role (`simRole` in the catalogue), plus knowledge scattered over five
places, each a hand-kept set of stencil ids:

- `src/stencils/netDevices.ts` (`DEVICE_SPECS`: size presets for the 19 devices);
- `src/checks/kinds.ts:8-45` (self-hosted compute and gateways, "not a front door");
- `src/stencils/edgeKind.ts` (in flight: `MODEL_APIS` for Request inference);
- `src/stencils/relations.ts` (which stencils imply a dependency);
- `src/gallery/stencilInfo.ts` (icon sources).

So the role decides almost everything. Lambda, a .NET pod, OpenAI and a rate limiter are all `processor` with 1 × 4 at
250 ms. Postgres, DynamoDB, Redis and S3 are all `store` with 40 ms and no limit. Stripe, Iterable (as Marketing
Automation) and an on-call engineer's Slack are all `sink`, which does nothing.

### 1.3 What a newcomer sees today

| Screenshot                                                                                    | What it shows                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-palette-default.png`](planning-model/01-palette-default.png)                             | First visit: only Messaging is open (`Palette.tsx:46`). Generic, where External API lives, is the ninth and last category.                                                                                                                                                                                                                                                                               |
| [`02-palette-clients-open.png`](planning-model/02-palette-clients-open.png)                   | Clients holds User, Browser, Mobile, Partner, IoT, Team, then **Stripe, Twilio**… but not External API.                                                                                                                                                                                                                                                                                                  |
| [`03-palette-search-api.png`](planning-model/03-palette-search-api.png)                       | Searching "api": External API is 7th of 12, after GraphQL, API Management, API Gateway, OpenAI, Claude and LLM.                                                                                                                                                                                                                                                                                          |
| [`04-palette-search-iterable.png`](planning-model/04-palette-search-iterable.png)             | "iterable" finds only **Marketing Automation**: Iterable is a word in its description (`catalog.ts:2013`) and an alias.                                                                                                                                                                                                                                                                                  |
| [`05b-inspector-service-simulation.png`](planning-model/05b-inspector-service-simulation.png) | A service: the checks lead (good), then Stencil, Label, Subtitle, Boundary, Simulation. Nothing says what a .NET service is, and the Simulation fields don't say where their numbers come from.                                                                                                                                                                                                          |
| [`06b-inspector-stripe-simulation.png`](planning-model/06b-inspector-stripe-simulation.png)   | Stripe: one field, Latency, which does nothing on master (F-12; batch 1 hides it, leaving none). No rate limit, no errors, no endpoints.                                                                                                                                                                                                                                                                 |
| [`07-inspector-f5.png`](planning-model/07-inspector-f5.png)                                   | F5 BIG-IP: the model to copy. A size preset named for its datasheet model, throughput with a sentence saying what it means in messages/s, HA, health checks. But nothing explains a pool, a virtual server or a health monitor.                                                                                                                                                                          |
| [`09-inspector-kafka-topic.png`](planning-model/09-inspector-kafka-topic.png)                 | Kafka topic: Partitions with a good note, and Max deliveries, a setting Kafka doesn't have (F-4, item 9).                                                                                                                                                                                                                                                                                                |
| [`10-tooltip-f5-edit.png`](planning-model/10-tooltip-f5-edit.png)                             | The edit-mode hover card: label, stencil, the one-line description. Nothing to follow.                                                                                                                                                                                                                                                                                                                   |
| [`12-live-hover-orders.png`](planning-model/12-live-hover-orders.png)                         | Live, Orders at 4 s per request: the callout says "Orders is over capacity · 300% · 3/s of 1/s · Fix: Orders 1 → 6 replicas". The hover card lists Processed, Throughput, Waiting 31, In flight 4, Replicas 1, Parallel per replica 4, Capacity 300%. Every number is there; the **why** (1 × 4 ÷ 4 s = 1/s), **who sends it** (Checkout, through the F5) and the **other fix** (make it faster) aren't. |
| [`13-gallery-drawer-f5.png`](planning-model/13-gallery-drawer-f5.png)                         | The stencil drawer: the description, "In a simulation: gateway · Passes requests through…", id, category, family, accent. The natural home for concepts and a link.                                                                                                                                                                                                                                      |

### 1.4 Gaps

Numbered G-n so the batches can cite them. Sim-flows findings (F-n) aren't repeated; where a gap extends one, it says
so.

| #    | Gap                                                                                                                                                                                                                                                     | Effect                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| G-1  | **One role, one behaviour.** Per-stencil knowledge lives in five hand-kept id sets (1.2). There's no place to say "Lambda scales to 1,000", "Service Bus dead-letters after 10", "Postgres takes 100 connections".                                      | Every realistic default is a special case in code; items 7–9 would add three more sets. |
| G-2  | **Stores never limit anything.** Unlimited parallelism in playback and `latencyMs: 0` in planning (`capacityPlanning.ts:42-49`). Postgres connections, DynamoDB write units, Cosmos RU/s, Redis ops/s and S3's per-prefix rates are invisible.          | The most common production bottleneck (the database) can't be one. Extends F-26.        |
| G-3  | **External APIs do nothing** (F-12): no latency, no rate limit, no errors, no endpoints. Third-party limits are what planning a Stripe or Iterable integration is about (Iterable's per-endpoint limits; Twilio's messages per second per sender).      | "Put Iterable up front" can't be planned.                                               |
| G-4  | **No caller settings.** A Request has no timeout, retries or connection pool. Item 10 (not approved) is what makes them matter in playback; their place in the model is needed now so the inspector and files don't change twice.                       | Retry storms, pool exhaustion and timeouts can't be drawn.                              |
| G-5  | **No consumer settings.** A consumer's parallelism is its node's concurrency, its group is an edge id by default (F-8), and retry behaviour is a node prop of the consumer (`retry`) that applies to every broker it reads.                             | A service reading two topics can't differ per topic; group names read "e3".             |
| G-6  | **No message size** outside network devices (`messageKB`). Kinesis (1 MB/s per shard), Event Hubs (1 MB/s per throughput unit), Confluent (~5 MBps per partition) and SQS (1 MiB max) are byte limits.                                                  | Shards and throughput units can't be sized.                                             |
| G-7  | **Brokers have no ingest limit** ("Brokers accepting into another broker can buffer without a modeled ingest limit", `SIMULATION.md`). SNS's publish quota, EventBridge's PutEvents quota, SQS FIFO's 300 TPS and Storage Queue's 2,000/s never bind.   | A broker is never the bottleneck.                                                       |
| G-8  | **No latency answer.** The trace shows one message's journey; nothing gives the request path's p50 or p95, or a budget.                                                                                                                                 | "Can checkout stay under 800 ms?" has no answer.                                        |
| G-9  | **No headroom answer.** The traffic multiplier exists (Inputs), but nothing says at what multiple the system first breaks, or where.                                                                                                                    | Growth planning is trial and error with a slider.                                       |
| G-10 | **Nothing explains a node in context.** The live hover card has the numbers (`NodeBadges.tsx:288-345`), the callout has a fix, the check has a sentence; none shows the arithmetic, who's sending, or the alternative fix (`12-live-hover-orders.png`). | The owner's example can't be read off the screen.                                       |
| G-11 | **Nothing teaches the stencil.** The inspector shows no description at all (`Inspector.tsx:295-430`); the hover card one line (`NodeTooltip.tsx:31-32`); the drawer one line and the role (`13-gallery-drawer-f5.png`).                                 | Someone who doesn't know BIG-IP, a pool or a health monitor learns nothing.             |
| G-12 | **External API is hard to find** and Iterable isn't a stencil (`01`–`04`).                                                                                                                                                                              | The owner's first attempt failed.                                                       |

## 2. The configuration model

### 2.1 Principles

1. **The few settings that drive behaviour.** Each family shows 2–5 settings by default: the ones that decide whether
   it keeps up, what it does when it can't, and how long it takes. Everything else is Advanced (folded, remembered), or
   isn't modelled.
2. **Presets, not typing.** A family's numbers come from a preset named for what it is ("Account default: 1,000
   concurrent", "Standard tier, 1 throughput unit", "Stripe live mode"), with its source and the date it was checked.
   A new node starts on its stencil's default preset, so a diagram drawn from scratch is already realistic. Typing over
   a value reads as an override of the preset, as a device's size does today.
3. **Cited or labelled.** The vendor sources below were checked on 2026-10-14. Defaults, limits, benchmarks and
   assumptions are different evidence classes; never ship an UNVERIFIED candidate as a vendor default.
   A number nobody publishes (a service's latency, a Postgres query's time, any SaaS
   API's p50) is marked **assumption** here and "typical: change it" in the hint. Stripe says so itself: to simulate
   its latency, sample your own live calls ([rate limits][stripe-rl]).
4. **Over the limit, say what the product does.** Some things queue (a service's backlog, a device's buffer, Twilio's
   10-hour message queue), some reject (API Gateway, Lambda's synchronous throttle, DynamoDB, Cosmos DB, nearly every
   SaaS API: 429). The family says which, and live view counts **rejected** apart from failed and dropped (sim-flows
   item 8).
5. **One engine, one resolution order.** Role defaults < family defaults < preset < node props < the simulation's
   setup props < live Inputs. `resolveProps` (`src/sim/defaults.ts:41`) already takes the stencil id for device
   presets; profiles generalise that, so playback, `analyzeCapacity`, the checks and live view can't disagree.
6. **Roles stay the dispatch contract.** Profiles refine them, including finite processing at an external `sink`.
   Old files retain the legacy resolver until an explicit, undoable model upgrade; adding a vendor default must
   not silently change saved playback. See section 4.4 for revisioning and migration.

### 2.2 Data model

Pure data, importable headlessly by the engine and the checks, like `src/stencils/netDevices.ts`:

```ts
// src/stencils/profiles.ts
import type { NodeSimProps } from "../sim/types";
import type { SimRole } from "../model/types";

export type FamilyId =
  | "log"
  | "queue"
  | "pubsub" // brokers by kind (item 7: "log" = partitioned)
  | "service"
  | "serverless"
  | "workflow"
  | "stream-processor" // compute
  | "sql"
  | "nosql"
  | "cache"
  | "search"
  | "object"
  | "warehouse"
  | "api-gateway"
  | "proxy"
  | "edge"
  | "dns"
  | "mesh"
  | "device"
  | "external-api"
  | "model-api"
  | "client"
  | "scheduler"
  | "telemetry"
  | "dependency";

// Proposed types, not declarations that compile against today's NodeSimProps.
// PlanningNodeProps is the proposed extension described in sections 2.3 and 4.3.
/** One setting a family shows. Files keep one flat `props` object. */
export interface SettingSpec {
  key: keyof PlanningNodeProps;
  /** i18n key, e.g. "sim.maxConcurrency". */
  label: string;
  unit?: "msg/s" | "req/s" | "ms" | "s" | "kB" | "MB/s" | "%" | "units" | "tokens";
  min?: number;
  max?: number;
  step?: number;
  /** "main": one of the 2–5 shown by default. "advanced": behind Advanced. */
  tier: "main" | "advanced";
}

export interface Preset {
  /** Persisted as props.preset: never renamed once shipped. */
  id: string; // "lambda-account-default"
  revision: string; // immutable published revision
  labelKey: string; // translated "Account default: 1,000 concurrent"
  values: Partial<PlanningNodeProps>;
  /** Every number's source, and when it was last checked. */
  sources: {
    key: keyof PlanningNodeProps;
    url: string;
    checked: string;
    evidence: "default" | "quota" | "benchmark" | "assumption" | "unverified";
    scope?: string;
    note?: string;
  }[];
  /** "Approximate" in the hint: a vendor's planning figure rather than a hard limit. */
  approximate?: boolean;
}

export interface FamilySpec {
  id: FamilyId;
  /** A family may refine more than one dispatch role: topic and stream, for example. */
  roles: SimRole[];
  settings: SettingSpec[];
  defaults: Partial<PlanningNodeProps>;
  /** Past the limit: wait (a backlog) or reject (counted as rejected: a 429). */
  overLimit: "wait" | "reject" | "unknown" | "none";
}

export interface StencilProfile {
  family: FamilyId;
  presets?: Preset[];
  /** The preset a new node starts on. */
  preset?: string;
  /** The vendor's words (F-8): "shard" on Kinesis, "subscription" on Service Bus and Pub/Sub, "rule" on EventBridge. */
  words?: { partition?: string; group?: string };
}

/** Explicit family per stencil. Unknown ids retain legacy role behaviour; never guess SQL or external API. */
export declare const PROFILES: Readonly<Record<string, StencilProfile>>;
```

The five hand-kept id sets in 1.2 fold into this one table over time (`isSelfHostedService` becomes "family
`service`", `MODEL_APIS` becomes "family `model-api`"); a unit test keeps every stencil mapped, as
`src/lib/vendorFamilies.ts` does for vendors.

Initial engine-field inventory (proposals, not current props; each needs bounds in `src/model/simProps.ts`).
Section 4.3 is authoritative for quotas and endpoints: the scalar convenience keys below must resolve into that
contract, never create parallel independent limits. Tail/token helpers land only with their named semantics.

| Prop                                                                                            | Families                                                      | Meaning                                                                                        | Origin      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------- |
| `preset`                                                                                        | all with presets                                              | The preset the node is on                                                                      | new         |
| `limitPerSec`, `burst`                                                                          | external-api, api-gateway, model-api, nosql, brokers (ingest) | Convenience for a simple RPS policy only; general quotas use typed units/windows (section 4.3) | item 8      |
| `scaling`, `maxConcurrency`                                                                     | serverless                                                    | `"auto"`: effective replicas follow demand up to `maxConcurrency`                              | item 8      |
| `connections`                                                                                   | sql, nosql (MongoDB), cache, search                           | Server connection ceiling; measured query slots remain separate (G-2)                          | new         |
| `hitRate`                                                                                       | cache, edge                                                   | The share answered without going further (F-15)                                                | F-15        |
| `messageKB`                                                                                     | log, queue, pubsub (devices today)                            | Average message size, for MB/s limits (G-6)                                                    | generalised |
| `partitionMBps`                                                                                 | log                                                           | Ingest per partition or shard                                                                  | new         |
| `deadLetter`                                                                                    | queue, pubsub, log                                            | `"built-in"` (Service Bus), `"route"` (draw one), `"poison"` (Storage Queue), `"none"`         | item 9      |
| `everyMs`, `perRun`                                                                             | scheduler                                                     | One run every N ms, with this many messages (F-13)                                             | F-13        |
| `p95Ms`                                                                                         | service, serverless, external-api, model-api                  | Deferred input convenience for a named distribution; never silently redefine latencyMs as p50  | new         |
| `endpoints`                                                                                     | external-api, service, api-gateway                            | Optional endpoints (section 4)                                                                 | new         |
| `requestsPerMin`, `tokensPerMin`, `tokensIn`, `tokensOut`, `outputTokensPerSec`, `firstTokenMs` | model-api                                                     | Quotas, per-request size and speed                                                             | new         |

Existing props retain their current meanings: `retryBackoffMs` is a consumer retry delay, not automatically a
visibility timeout or lock duration. `maxDeliveryCount` remains the broker's delivery budget and `concurrency`
the service's parallel work per replica. External error/latency behaviour is a proposed family extension.

### 2.3 By family

The family mapping is **behavioural**, distinct from today's vendor filter in `vendorFamilies.ts`. A Kafka topic
and a Kafka cluster are different objects: a cluster is infrastructure, not a second topic hop. Explicit mappings
must cover every catalogue entry; wrappers (AKS, GKE, deployments), tools (dbt, Terraform), and dependency nodes
must not acquire traffic just because their vendor has a throughput figure.

**Evidence key:** vendor default = the product starts with this; quota = a scoped limit; benchmark = workload-specific;
assumption = an editable teaching value. UNVERIFIED = do not ship that vendor preset until checked. Sources are
linked beside the facts. Ranges labelled “editor” are proposed bounds, not vendor-supported limits. `unset` means
unknown/unmodelled, not unlimited in reality. Persist named, versioned presets and their resolved values; never
reinterpret a file when a vendor changes its documentation.

#### Brokers: partitioned log, queue and pub/sub

| Family and coverage                                                                                                                        | Main settings (2–5)                                                           | Defaults and size presets                                                                                                                                                                                                                                                                                                                    | Advanced / hidden and range                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Log:** Kafka Topic, MSK/Confluent topic workloads, Event Hubs, Kinesis, Pulsar, Redis Stream, Event Store                                | Partitions/shards; ingest limit; message size; consumer failure policy        | Existing lesson preset: 3 partitions, 1 kB/message (assumption). Kafka 4.2 broker `num.partitions` default 1, valid ≥1; retention 168 h. Kafka has no universal delivery-attempt count or automatic DLQ. Retry/skip is client policy. [Kafka broker settings][kafka-broker]                                                                  | Retention, per-partition byte limit and consumer offsets. Editor partition bound 1–10,000 initially; keys/hot partitions and share groups deferred. Keep “3 partitions” visibly a lesson, not a Kafka default.                                                                                          |
| **Queue:** Service Bus Queue, SQS, Storage Queue, RabbitMQ Queue/MQ, Generic Queue                                                         | Delivery limit; lock/visibility duration; dead-letter destination; throughput | Service Bus preset: 10 deliveries, lock 60 s (maximum 300 s), built-in DLQ; explicit abandon can redeliver earlier than lock expiry. SQS: visibility 30 s, valid 0–43,200 s; default retention 4 days, valid 60 s–14 days. DLQ requires redrive policy. [Service Bus settings][sb-settings], [settlement][sb-lock], [SQS quotas][sqs-quotas] | Prefetch, renewal, batch size, retention. Editor delivery count 1–1,000; vendor-specific bounds override. RabbitMQ quorum default 20 deliveries and Storage Queue trigger default 5 are **UNVERIFIED inherited candidates**, not generic defaults.                                                      |
| **Pub/sub:** SNS, EventBridge, Event Grid, Service Bus Topic/subscriptions, Pub/Sub, RabbitMQ Exchange/bindings, NATS, MQTT, Generic Topic | Publish limit; delivery policy; subscription/filter; dead-letter destination  | No replica cap from partitions for item 7's non-partitioned fan-out. Generic lesson: no ingest limit, 3 delivery attempts (assumption). Pub/Sub ack deadline default 10 s, configurable 10–600 s; dead-letter policy is opt-in, 5–100 attempts, approximate enforcement. [Pub/Sub properties][ps-props], [dead letters][ps-fail]             | Backoff, ack deadline, push/pull mode and batching. Not every subscriber protocol uses consumer groups; inspector says “Subscription” or “Binding” when appropriate. Service Bus topics reuse subscription lock/DLQ defaults, without equating Service Bus partitioning with Kafka consumer assignment. |

**Managed broker size presets** use the product's actual unit, not invented Small/Medium/Large CPU sizes:

| Preset                                          | Verified planning quantity                                                                                | Interpretation                                                                                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event Hubs Standard, 1 / 2 / 4 throughput units | Per TU ingress 1 MB/s **or** 1,000 events/s; egress 2 MB/s **or** 4,096 events/s. [Scalability][eh-scale] | Both caps apply; use the first exhausted. TUs are namespace-wide and shared by hubs, not granted afresh to each topic.                                                                                   |
| Kinesis provisioned, 1 / 2 / 4 shards           | Each shard supports 1 MB/s or 1,000 write records/s and 2 MB/s read. [Quotas][kinesis-limits]             | Aggregate only under uniform load; larger records or hot keys invalidate the estimate.                                                                                                                   |
| Self-managed Kafka / Pulsar / Redis Stream      | No portable vendor messages/s preset                                                                      | Offer “Measured workload” with user-entered ingest rate and message size. The draft's Confluent 5/12 MB/s per partition and MSK Express 15/30 MB/s figures are **UNVERIFIED** and excluded from presets. |
| Generic queue / pub/sub                         | Lesson rate unset; message size 1 kB (assumption)                                                         | Cite vendor quotas per region and subscription before adding a product preset; don't reuse SQS FIFO TPS as messages/s without batch size.                                                                |

#### Compute: service, serverless, workflow and stream processor

| Family and coverage                                                                                             | Main settings                                                         | Defaults / presets                                                                                                                                                                                                                                                                                                    | Advanced / boundaries                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service:** language services, generic service, pods/containers, ECS/App Service, projection/saga/batch worker | Replicas; mean processing time; parallel work per replica; errors     | Keep existing lesson 1 × 4 at 250 ms, 0% errors. Kubernetes Deployment replicas default 1, but runtime concurrency and service latency must be measured. [Deployment spec][k8s-deploy]                                                                                                                                | Input/caller capabilities below; queue capacity; measured latency distribution. Editor replicas 1–10,000, parallel work 0–10,000, mean time >0 up to 600,000 ms, errors 0–100%. Zero slots means paused capacity. Avoid Java thread count = req/s or one default across all runtimes.                                                                               |
| **Serverless:** Lambda, Functions, Cloud Run/functions, Container Apps, Workers, Vercel, Netlify                | Scaling preset; max concurrent work; mean duration; execution timeout | Lambda standard-function preset: shared account/Region concurrency quota 1,000, duration 250 ms (assumption), timeout default 3 s, range 1–900 s. New accounts can have lower quotas. Reserved concurrency is a cap/reservation, not minimum running instances. [Concurrency][lambda-conc], [timeout][lambda-timeout] | Cold start and scale-up are workload assumptions unless a versioned measurement is supplied. Sync invocation throttles; async/event-source retry depends on trigger. Workers' subrequest budget is **per invocation**, not concurrent work. Other providers' inherited 100 × 80 or 100 × 16 values are **UNVERIFIED** until tier and deployment method are checked. |
| **Workflow:** Step Functions, Logic Apps, Temporal, Camunda                                                     | Start rate; concurrent executions; duration                           | No generic vendor capacity. Lesson duration 1 s, limits unset (assumptions). Offer Standard/Express or Consumption/Standard presets only with product-specific sources.                                                                                                                                               | Execution history, durable timers and state transitions excluded initially; process duration is not a request's blocking duration. Inherited 300/6,000 starts/s and 100,000 actions/5 min figures are **UNVERIFIED**.                                                                                                                                               |
| **Stream processor:** Flink, Dataflow, Streams, ksqlDB, Connect; CDC when flowing                               | Replicas; parallel work; processing time; consumer group              | Service lesson plus capability on each broker connection. Debezium CDC receives database changes; it isn't arbitrary user traffic.                                                                                                                                                                                    | Check partition assignment only for actual partitioned input. Batch ELT/Reverse ETL uses scheduler/run semantics, not a constant HTTP source. Wrapper nodes are dependencies unless explicitly modelled as workloads.                                                                                                                                               |

Presets for a self-hosted service are “Measured workload” and “Lesson”, not hardware promises. CPU/memory are
optional descriptive inputs for cost later; increasing CPU must not magically double throughput without an explicit
capacity curve. New serverless nodes reserve only an **allocated share** of an account quota unless the diagram
explicitly represents the entire account. Shared quota groups are described in section 4.3.

#### Data stores

| Family and coverage                                                                                     | Main settings                                           | Verified defaults / size presets                                                                                                                                                                                                                                                                                                    | Limit behaviour and advanced settings                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SQL:** PostgreSQL/MySQL/SQL Server, Azure SQL/Cloud SQL/Aurora/Spanner/Supabase, Generic Database     | Active-query slots; mean query time; connection ceiling | PostgreSQL `max_connections` typically 100, with 3 superuser-reserved slots and 0 extra reserved slots. Lesson query time 5 ms and 4 active-query slots are assumptions. 100 connections does **not** prove 100 simultaneous queries at the same latency. [Connections][pg-conn]                                                    | Client pool queues; database may reject new connections. Pool per caller edge, server connection cap on node. Lock contention, query mix and transaction duration advanced; hosted size presets need measured/vendor workload curves. Inherited MySQL 151 and Azure/Aurora tier counts are **UNVERIFIED** here. |
| **NoSQL:** DynamoDB, Cosmos DB, Firestore, MongoDB, Cassandra                                           | Capacity units/s; units/request; mean latency           | DynamoDB new on-demand table: warm 4,000 write units/s and 12,000 read units/s, not arbitrary-size operations. Cosmos manual minimum starts at 400 RU/s and grows with storage/history; a physical partition tops out at 10,000 RU/s. [DynamoDB warm throughput][ddb-warm], [Cosmos scaling][cosmos-scale], [limits][cosmos-limits] | Reject/throttle under configured cap. Read/write mix, item bytes and consistency determine units/request. Offer Cosmos 400 / 1,000 / 4,000 RU/s as **chosen allocations**, not fixed SKU capacities; no uniform-key claim.                                                                                      |
| **Cache:** Redis, Azure Redis, Generic Cache                                                            | Hit share; measured ops/s; latency                      | Lesson hit share 90%, latency 1 ms (assumptions), ops/s unset. Redis `maxclients` default 10,000, constrained by OS descriptors. [Client handling][redis-clients]                                                                                                                                                                   | Client count is not ops/s or parallel operations. TTL, eviction, payload size, warm/cold cache advanced. Benchmark rates 180k SET/s and Azure C1/P1 rates are **UNVERIFIED inherited candidates**; no hardware preset from them.                                                                                |
| **Search/vector:** Elasticsearch, Pinecone, Generic Search/Vector DB                                    | Query slots; mean query time; ingest ceiling            | Lesson 4 slots at 20 ms; ingest unset (assumptions). Vendor sizes unset until a measured index/query workload is supplied.                                                                                                                                                                                                          | Reject or queue according to configured queue capacity; index size and query complexity are assumptions. Inherited thread formula is **UNVERIFIED**; do not apply Elasticsearch defaults to Pinecone.                                                                                                           |
| **Object storage:** S3, Blob, GCS, MinIO                                                                | Requests/s; read/write mix; latency; object size        | S3 achieves **at least** 3,500 write and 5,500 read requests/s per partitioned prefix and scales gradually. Lesson latency 30 ms is an assumption. [S3 performance][s3-perf]                                                                                                                                                        | This is a performance baseline, not a hard ceiling; show “planning target”. 503 Slow Down is a ramp/failure scenario. Byte throughput and KMS caps advanced. Azure/GCS inherited rates are **UNVERIFIED**.                                                                                                      |
| **Warehouse:** Snowflake, BigQuery, Redshift, Databricks, ClickHouse, Synapse/Fabric, Generic Warehouse | Concurrent queries; mean duration; queue capacity       | Snowflake `MAX_CONCURRENCY_LEVEL` default 8; lesson duration 1 s (assumption). It doesn't guarantee eight queries execute with equal cost. [Snowflake parameter][sf-params]                                                                                                                                                         | Warehouse size/scaling, workload mix and queue timeout advanced. Other vendors retain measured/lesson presets until verified; Redshift default 5 and ClickHouse unlimited are **UNVERIFIED inherited candidates**.                                                                                              |

A node's measured active-query slots can feed a simplified `slots / mean service time` estimate, labelled as such.
Before item 10, store-side queuing can be modelled but cannot predict caller exhaustion. Cache hit share reduces
origin traffic only for an explicit cache-through route; cache-aside means the **service** decides whether to call
the database. Don't blindly forward every cache miss from a terminal `store` or count both routes on a hit.

#### CDN and DNS/global routing

| Profile                       | Main settings                                                    | Cited defaults and ranges                                                                                                                                                                                                                                                          | Advanced / simulation boundary                                                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CDN / Cloudflare / Front Door | Cache-hit share; cache TTL; origin timeout                       | Hit share 80% is an assumption. Cloudflare caches eligible 200/206/301 responses for 120 min, 302/303 for 20 min, 404/410 for 3 min **when origin cache headers are absent**; JSON/HTML aren't cached by default. TTL is not a fixed hit rate. [Default cache behaviour][cf-cache] | Eligibility and cache keys advanced; dynamic API lesson starts uncached. Origin timeout has its own semantic type. No synthetic CDN req/s cap.                                                     |
| Cloudflare Workers Paid       | Mean duration; invocation subrequest budget; subrequests/request | Paid default 10,000 subrequests/invocation, configurable up to 10 million; Free 50. [Workers limits][cf-workers]                                                                                                                                                                   | Show this only for Workers, not ordinary CDN nodes. It bounds each invocation's fan-out, not inbound RPS. Failure from exceeding the budget is distinct from a provider 429.                       |
| Route 53                      | Routing policy; DNS TTL; health-check preset                     | API `RequestInterval` default 30 s (10 or 30); `FailureThreshold` default 3, range 1–10. Non-alias records require a TTL; no universal default. Alias TTL comes from target, e.g. ELB 60 s. [HealthCheckConfig][r53-hc], [record TTL][r53-record], [ELB routing][elb-routing]      | Probe details advanced. Detection plus cached DNS response expiry affects failover. It is a routing dependency, not latency on every message. No claim that failure always occurs exactly at 90 s. |
| Traffic Manager               | Routing policy; DNS TTL; health-check preset                     | Interval 30 s default (10/30), tolerated failures 3 (0–9): unhealthy on **fourth** consecutive failure. Normal-probe timeout default 10 s, range 5–10 s; fast-probe default 9 s, range 5–9 s. CLI TTL default 30 s. [Monitoring][tm-monitor], [CLI][tm-cli]                        | Multi-location probes and client caches make failover a range. Generic DNS lesson TTL 60 s is an assumption. Do not confuse tolerated failures with Route 53's threshold.                          |

DNS TTL, cached-object TTL and broker retention all use seconds but control different things. The inspector says
which data expires and where. A “fast failover” preset is a named configuration derived from supported probe
options, not a claim that DNS clients honour the TTL exactly.

For a Cloudflare DNS profile, proxied records default to **Auto = 300 s** and cannot edit that TTL. DNS-only records
can use Auto = 300 s or a chosen TTL from 60 s (30 s for Enterprise) to 1 day. [DNS TTL][cf-dns-ttl]

#### Cloud gateways and load balancers

Main controls: **preset/units**, **rate or measured capacity**, **routing**, **health checks**, and **timeout**
where implemented (at most five). Advanced holds burst, detailed probe fields, idle/connect/read distinctions and
payload size. **Timeout enforcement in a request chain depends on unapproved item 10**; until then display it as
education or an explicit “planning only” assumption, never an enabled control that does nothing.

| Product preset                   | Verified defaults / ranges                                                                                                                                                                                                                                                                                                                                                  | What the planner must distinguish                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API Gateway REST                 | Account/Region steady quota 10,000 req/s, token bucket 5,000; listed smaller Regions 2,500/1,250. Integration timeout 50 ms–29 s baseline. Regional/private timeout can be raised beyond 29 s, possibly reducing the account throttle quota; edge-optimised cannot. Cache TTL default 300 s, range 0–3,600 s. [Account quotas][apigw-throttle], [REST quotas][apigw-limits] | Shared quota, optional method/usage-plan caps and integration timeout; not maximum handler duration or HTTP API's defaults. Excess API requests reject (429).                                                                                                    |
| APIM **classic** 1 / 2 / 4 units | Informational per-unit maximums: Developer 500, Basic 1,000, Standard 2,500, Premium 4,000 req/s. Microsoft explicitly says not to rely on these figures for capacity/budget planning; load testing is required. [Pricing table][apim-pricing]                                                                                                                              | Benchmark preset, not a quota that must reject at that rate. Label “illustrative”; independent rate-limit policies can reject. Don't transfer classic values to v2 tiers.                                                                                        |
| ALB instance/IP target           | Idle timeout default 60 s, range 1–4,000 s. Health interval 30 s (5–300); probe timeout 5 s (2–120); healthy threshold 5, unhealthy threshold 2 (both 2–10). Lambda targets differ. [Idle timeout][alb-idle], [health checks][alb-hc]                                                                                                                                       | Idle time means inactivity, not whole-request deadline. Target routing uses health and configured algorithm; if all targets are unhealthy ALB fails open. No portable req/s size.                                                                                |
| NLB                              | Health timeout 6 s for HTTP, 10 s TCP/HTTPS (2–120); interval 30 s (5–300); healthy 5 and unhealthy 2 (2–10). [NLB checks][nlb-hc]                                                                                                                                                                                                                                          | Consensus/distributed checks; L4 connection routing and capacity cannot be copied from ALB. Use an NLB profile under existing ELB stencil before adding another visual.                                                                                          |
| Application Gateway              | Default probe interval 30 s, timeout 30 s, unhealthy threshold 3. Backend request timeout 20 s; private backend range 1–86,400 s, external backend 1–240 s. [Probes][agw-probe], [backend settings][agw-settings]                                                                                                                                                           | Probe timeout and request timeout differ. SKU/back-end location is part of preset; capacity must be measured. Detailed probe bounds not confirmed here: **UNVERIFIED**, don't invent them.                                                                       |
| Front Door Standard/Premium      | Microsoft's service-limits page says 60 s before first origin packet (classic 30 s); its troubleshooting page calls the default 30 s, even while discussing Standard/Premium configuration. Configurable origin response timeout range 16–240 s. [Service limits][afd-limits], [troubleshooting][afd-troubleshoot], [configuration][afd-config]                             | **Verified documentation conflict; effective default UNVERIFIED.** Offer “documented 60 s” and “documented 30 s” planning assumptions; require deployed value before reliability claims. Don't resolve the discrepancy by averaging or assuming SKU explains it. |
| GCP backend service              | Most load balancers: default 30 s, valid 1–2,147,483,647 s. [Backend services][gcp-backend]                                                                                                                                                                                                                                                                                 | For HTTP(S) application LBs it is a request/response timeout; passthrough NLB ignores it. An editor may bound simulated duration more tightly and say so.                                                                                                        |

Health detection estimates must include probe phase, timeout and threshold semantics; `interval × threshold` is a
rough bound under a stated simplified probe model. Recovery needs its own success threshold. Don't give instant
knowledge of a down target to a simulated load balancer while explaining delayed health checks.

#### Proxies and meshes

| Product         | Main behaviour settings / presets                                                 | Cited default details for Advanced and About                                                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NGINX           | Workers/connection ceiling; routing; passive health policy; upstream read timeout | `worker_connections` 512 **per worker**, includes upstream connections; not 512 requests in flight. `proxy_read_timeout` 60 s **between reads**, not whole response. Upstream `max_fails` 1 / `fail_timeout` 10 s; with only one server these are ignored. [Core][nginx-core], [proxy][nginx-proxy], [upstream][nginx-upstream]                                |
| HAProxy 3.3+    | Routing; measured connection ceiling; active health policy; explicit timeouts     | Default balance changed to `random` from 3.3; earlier versions round robin. Checks when enabled: `inter` 2,000 ms, `rise` 2, `fall` 3. Client/connect/server timeouts have **no finite default**; unspecified is infinite and warned about. [3.3 release][haproxy-release], [manual][haproxy]                                                                  |
| Envoy           | Max connections; max active requests; pending queue; outlier policy               | Circuit breaker defaults 1,024 connections / pending requests / parallel requests, **3 concurrent retries**, per upstream cluster/priority. This is not three retries per request. Outlier config: consecutive 5xx 5, sweep 10 s, base ejection 30 s, max ejection 10%; requires configured detection. [Circuit breakers][envoy-cb], [outliers][envoy-outlier] |
| Istio / Linkerd | Per-hop latency assumption; connection policy; retry policy when supported        | Istio **1.24 benchmark**, 1,000 HTTP req/s at 1 kB payload with two worker threads: about 0.20 vCPU and 60 MB per sidecar. [Performance][istio-perf] No inference of max RPS or ms latency from that result. Linkerd's inherited “p99 under 1 ms” claim is **UNVERIFIED**; use measured values.                                                                |
| Kong            | Enabled rate-limit policy; requests/window; key scope                             | Plugin supports second/minute/hour/day/month/year windows and returns 429 when any configured cap binds. No universal default request limit: configure a window. Counter storage/distribution and fail-open are advanced. [Plugin][kong-rl], [schema][kong-schema]                                                                                             |
| Traefik         | Enabled rate-limit middleware; average rate; burst; source scope                  | Default `average` 0 (disabled), `period` 1 s, `burst` 1. Rate = average/period, token bucket; default scope is source IP. [RateLimit][traefik-rl] A diagram-wide total quota is an explicit aggregation assumption, not a per-IP default.                                                                                                                      |

Preset naming includes software version (HAProxy 3.2 vs 3.3, Envoy configuration, Istio benchmark) rather than
invented hardware sizes. “Lesson: 100 req/s” for Kong or Traefik is a user policy, never a shipped vendor default.
Outlier ejection, circuit breakers and caller retries need item 10 for propagated failures and held caller slots;
plain routing/counting is independent.

#### Network devices

Keep the existing 19 device presets and named datasheets in [`network-infrastructure.md`](network-infrastructure.md)
and `netDevices.ts`: **size**, **throughput**, **HA**, **health checks**; latency and message size become Advanced
where the four main fields suffice. The size is a planning benchmark, not observed wire throughput. A firewall
connection's `deny` is intentional blocking. Later add ADC probe detection, with a regression for delayed target
removal. Do not emulate iRules or a full firewall policy language.

#### External APIs, model APIs, clients and schedulers

| Family                                                                                  | Main settings                                                         | Defaults and ranges                                                                                                                                                                                                                                                | Advanced / hidden                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **External API**                                                                        | Preset; request quota; latency; errors; optional Endpoints disclosure | Generic: quota unknown, mean latency 100 ms, errors 0% (assumptions). Vendor profile uses section 4's scoped quotas; editor errors 0–100%, latency >0–600,000 ms.                                                                                                  | Concurrency and shared quota groups, response bytes, tail distribution, provider delivery backlog. Rate quota unset must say unknown.                                                                                                                   |
| **Model API** (OpenAI, Claude, generic LLM/hosted ML)                                   | Model/tier preset; RPM; token quota; tokens/request; latency          | No universal limit; OpenAI Build standard Astra/Sol/Terra table: 5,000 RPM, 1,000,000 TPM. Claude Start Opus/Sonnet 4.x table: 1,000 RPM, 2,000,000 ITPM, 400,000 OTPM, with shared model-class buckets. [OpenAI limits][openai-rl], [Claude limits][anthropic-rl] | Separate input/output tokens, cache accounting, streaming time-to-first-token and completion time; quota accounting follows each provider. All latency/speed numbers are assumptions. Org/project quotas are shared; model/tier/date belongs in preset. |
| **Client/source** (User, Browser, Mobile, IoT, Partner/webhook when generating traffic) | Rate; traffic shape; message type                                     | Existing 2/s lesson. “1,000 devices every 60 s” helper yields 16.67/s (assumption). Editor rate 0–10,000/s for legacy files; higher managed capacities require deliberate schema widening, not inspector-only bounds.                                              | Users × calls/user, batch size, schedules. Incoming partner traffic vs outgoing Partner API is selected by connection direction/capability. Team/GitHub/CI/IaC use Deploys dependencies by default.                                                     |
| **Scheduler/run** (Scheduler, Airflow and batch starters)                               | Run interval; messages/run                                            | Lesson 60 s, one message/run, first run at t=0 (assumptions). Editor interval >0, count ≥1 with bounded event generation.                                                                                                                                          | Calendar schedules/time zone and run overlap. Do not simulate Terraform deployments as application messages/s.                                                                                                                                          |

#### Observability: settings without pretending it is application capacity

Telemetry dependencies carry no application messages. **No Simulation controls by default** on such a node; About
can show these facts. If the user explicitly draws a **Telemetry workload** flow, show 2–5 relevant settings:
**sampling**, **batch size**, **flush interval**, **ingest limit**, **payload bytes**; exporter buffer/drop policy
advanced. A pull collector instead shows scrape interval and timeout. Rates use telemetry records, not app requests.

| Product                                                            | Verified default / limit and scope                                                                                                                                                                                                                                                                                       | Planning consequence                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prometheus                                                         | Global scrape interval 1 min, scrape timeout 10 s; timeout cannot exceed interval. [Configuration][prom-config]                                                                                                                                                                                                          | Pulls metrics; not an HTTP sink called once per business request. Sample count/cardinality matters more than app RPS.                                                                                              |
| OpenTelemetry Collector                                            | Batch send trigger 8,192 records, timeout 200 ms; max batch size default 0 = no upper cap. `memory_limiter` `limit_mib`, `limit_percentage`, `check_interval` default 0; a positive configuration is required, so zero isn't a usable automatic memory budget. [Batch][otel-batch], [memory limiter][otel-memory]        | Trigger ≠ maximum batch. Collector can refuse data under memory pressure; upstream exporters may back off. SDK synchronous export can affect app latency: don't state telemetry can **never** slow an application. |
| Datadog                                                            | Logs: ≤5 MB uncompressed payload, ≤1 MB/log (larger logs truncated), ≤1,000 logs/array. Logs and metric submission aren't generally rate-limited; event submission 250,000/min/org. Metrics API v2 payload 512,000 bytes, decompressed <5,242,880 bytes. [Logs][dd-logs], [rate policy][dd-rates], [metrics][dd-metrics] | Payload rejection/truncation differs from 429. Endpoint/transport matters: don't substitute OTLP's limits for the HTTP v2 API.                                                                                     |
| Application Insights                                               | Java agent 3.4+ defaults to rate-limited sampling, approximately **5 traces/s**. Other languages/distributions vary. [Configuration][ai-sampling]                                                                                                                                                                        | Sampling controls visibility/cost; not an application RPS ceiling. Name language and version in preset.                                                                                                            |
| Splunk HEC                                                         | Splunk Enterprise 9.0.8 `http_input.max_content_length` default 838,860,800 bytes, approximately 800 MB in vendor wording (800 MiB). [Configuration reference][splunk-hec]                                                                                                                                               | Maximum HTTP content size, **not** MB/s throughput; don't carry this historical Enterprise default into Cloud/Edge Processor.                                                                                      |
| Jaeger                                                             | Collector remote-sampling fallback in v1.27: probabilistic 0.001 = 0.1%. [Sampling][jaeger-sampling]                                                                                                                                                                                                                     | Versioned example, not an OpenTelemetry SDK universal default or current Jaeger v2 claim.                                                                                                                          |
| CloudWatch PutMetricData                                           | 500 requests/s/account/Region (adjustable), ≤1 MB/POST and ≤1,000 metrics/request; up to 30 dimensions/metric. [Quotas][cw-quotas], [API][cw-api]                                                                                                                                                                        | Batch records before comparing to request quota; this does not cap the whole CloudWatch service at 500 events/s.                                                                                                   |
| Grafana, Loki, ELK, Sentry, Honeycomb and other telemetry stencils | Product-specific defaults **UNVERIFIED** here                                                                                                                                                                                                                                                                            | Family education now; explicit ingest modelling later with signal/plan-specific profiles, not invented universal rates.                                                                                            |

#### Security, identity and configuration

Identity/secret/config/deployment dependencies have no traffic settings. About explains what the dependency means.
An explicit Request to Okta/Auth0 enables external-API behaviour for the called endpoint (section 4), without
turning every identity dependency into a flow. Cryptography, authentication correctness, IAM decisions and secret
rotation aren't simulated. A firewall's allow/deny rule is not a complete security assessment.

### 2.4 What stays advanced, hidden or out of scope

Advanced: tails, bursts, shared quota identifiers, connection pools, keys/hot partitions (later), cold starts,
retention, acknowledgement/renewal and SDK retry detail. Hide a field whenever its engine effect is unsupported;
show the concept and current limitation in About instead. Dependencies and infrastructure wrappers can have zero
traffic controls: the 2–5 rule is a ceiling for applicable settings, not a reason to invent two controls everywhere.

Defer packet-level TCP/TLS, SQL query execution, provider billing engines, arbitrary scripts/iRules, calendar
execution and correlated outage inference. Never equate an SLA with independent per-request error probability or
multiply vendor SLAs to promise composite availability; common dependencies violate that assumption.

### 2.5 The inspector, simple by default

```text
Simulation                                         serverless
  Preset          [ Lambda standard: allocated concurrency ▾ ]
  Concurrency     [ 100 ]   chosen share of the account's quota
  Mean duration   [ 250 ] ms   assumption: replace with a measurement
  Execution timeout [ 3 ] s   planning only until enforced
  ▸ Advanced      shared account quota, cold start, distribution

Connections
  Consumes orders · group billing
  Calls Payments · POST /charges
  Publishes order-confirmed
▸ About Lambda
```

The preset includes its version, evidence and checked date. A field explicitly says Default, Measured or Assumed;
typed overrides have Reset to preset. For an existing legacy node, changing the preset previews changed behaviour
and is one undo step. A timeout that is not enforced appears as prose, as above, rather than an editable dead control.
No new top-bar button, no forced configuration wizard, no per-node settings modal. Capability rows expand in the
existing inspector, with keyboard access and `data-testid` on every interactive control.

## 3. Roles and capabilities

### 3.1 Are all services consumers?

**No.** A service serving HTTP is a processor/server. It becomes a broker consumer only through a broker → service
**Message** connection; “consumer” is a relationship, not a service stencil or permanent flag. A service can consume,
publish and call APIs simultaneously. Receiving an HTTP request is not a Kafka consumer group, even though “consumer”
has a broader everyday meaning. [Kafka introduction][kafka-intro] distinguishes producers and consumers by writing
and reading events.

Capabilities are a **derived view** of explicit flow relationships and family compatibility. Don't persist a second
`isConsumer` flag that can drift when an edge reconnects. A broker → worker edge marked `dlq` transports dead letters;
it isn't an ordinary consumer subscription. Dependencies never grant traffic capabilities. Ambiguous connections
remain explicit user choices, with the existing action registry handling edits.

| Connection                                      | Capability and settings                                                                                     | Storage and inspector                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kafka topic → Orders, Message                   | Consumer: named group, workers per replica (optional cap), retry/skip policy; Advanced prefetch/ack/renewal | Edge `group` and `consumer`; node row “Consumes orders · group billing”. Broker partitions/retention stay on broker; replicas and total slots on Orders.                                |
| Queue → Orders, Message                         | Queue consumer: parallel work cap, ack/lock policy; competing readers                                       | Edge `consumer`; optional reader-set name is descriptive, **not** pub/sub fan-out. Hide `group` when the engine doesn't use it.                                                         |
| Pub/sub → Orders, Message                       | Subscriber: named subscription/binding, filter, delivery policy                                             | Edge `group` where it identifies a delivery group, `filter`, and `consumer`; use vendor vocabulary. No Kafka partition slider.                                                          |
| Orders → topic/queue, Message                   | Producer: emits type, mean message size; Advanced batch count, delivery guarantee/ack and retry policy      | Edge `emits`, `producer`; node row “Publishes OrderPlaced to orders”. Business generation rate belongs on the node/traffic profile; don't add an unrelated producer rate.               |
| Orders → Payments, Request                      | Caller: target endpoint; Advanced deadline, retry policy, outbound connection-pool cap                      | Edge `endpointId`, `caller`; node row “Calls Payments · POST /charges”. Target latency/errors/rate limits belong to target node or endpoint. Timeout/retry execution waits for item 10. |
| Service → config/telemetry/identity, Dependency | Reads config, exports telemetry, uses identity                                                              | Existing edge relationship, no consumer/caller settings. A separately chosen Request to an identity API gets caller capability.                                                         |

### 3.2 Shared node budget, separate connection policy

Node replicas and concurrency describe one shared resource pool. Connection parallelism can **cap** its share, never
create another full pool for each topic or API. For a Kafka group, assigned reader instances cannot exceed input
partitions; processing concurrency within one assigned instance is a separate application assumption. Preserve
partition order unless the chosen client policy says otherwise; this first model does not simulate keys/order.

For two input topics, compute their demands together against the node's pool and report allocations. Do not solve
each independently and promise both the same slots. Group identity is `(broker node id, group name)`; the same
group string on a different topic may describe the same application group, but offset/partition bookkeeping stays
per topic. A literal shared group across separate diagrams is not inferred.

Default group names are human-readable (e.g. `billing`) and persisted on **new** connections. Legacy omitted groups
continue using edge id, today's contract; offer Rename group explicitly. Changing a group changes fan-out semantics,
so don't silently assign all old edges the target label. Removing a connection removes the capability view but
reconnecting preserves its stored settings; incompatible dormant props are retained and explained, not executed.

Retries and redelivery need distinct budgets: the broker entity's delivery limit, the consumer application's retry
attempts within one delivery, the producer's publish retries, and the API caller's request retries. Avoid multiplying
these unknowingly. An idempotency assumption is required before suggesting retries for side-effecting requests.

### 3.3 Mapping existing edge props

| Existing key | Keep its current meaning                                         | Proposed use / migration                                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `group`      | Topic/stream consumer delivery group; omitted = edge id          | Canonical group field, shown in capability row. No duplicate `consumer.group`.                                                                                                                                  |
| `share`      | Independent probability of a fan-out copy, default 1             | Selection probability, **not** HTTP request frequency, quota allocation or LB routing weight. Request workload mix uses its existing probability carefully; new weighted routing needs its own field/semantics. |
| `dlq`        | Broker's dead-letter route; explicit false opts out of inference | Keep broker-side destination. Built-in vendor DLQs are node profile behaviour; client skip/DLT publishing is a separate declared policy.                                                                        |
| `travelMs`   | Existing simulation transit/visual timing                        | Keep legacy playback meaning. Introduce physical network delay separately for latency planning; don't report the 450/900 ms animation defaults as measured network latency.                                     |
| `filter`     | Message-type subscription filter                                 | Consumer/subscriber section, bounded wildcard matching; not endpoint path matching.                                                                                                                             |
| `emits`      | Edge-specific rename overriding source node's emits              | Producer section and downstream message label.                                                                                                                                                                  |
| `deny`       | Intentional block at source                                      | Firewall rule, no caller retries or loss classification for a known intentional deny.                                                                                                                           |

Consumer `retry` and `retryBackoffMs` exist on the **processor node** today. Resolution for upgraded diagrams:
explicit edge consumer override > explicit node retry settings > versioned broker/client policy > legacy fallback.
Preserve node keys for backward compatibility; offer Move to connection with preview, not automatic copying of a
single policy to unrelated inputs. Visibility/lock expiry gets separate broker fields; it is not synonymous with
retry backoff. `failureRate` today is per-attempt processor failure; the external family adds that effect at its sink.

## 4. External APIs, SaaS and optional endpoints

### 4.1 Discovery and vendor selection

`generic.external-api` exists in `src/stencils/catalog.ts` under Generic (around line 1813), with `sink` role.
`CATEGORY_ORDER` places Generic ninth; `Palette.readClosed()` folds every section but Messaging on first visit.
An “api” search ranks several gateways and model APIs ahead of it (screenshot 03); the Clients section already
contains Stripe/Twilio but not the generic API. This explains the owner's unsuccessful search without assuming
the stencil is missing.

**Recommendation:** move the unchanged id to **Clients & external**, first among external systems; keep source
clients and called external systems in two labelled subgroups. Add search aliases “third-party API”, “SaaS”,
“REST API”, “HTTP API”, “vendor API”. This uses the existing category and adds no rail/top-bar control. A dedicated
**External** category is a reasonable later option if the subgroup is too long; don't add it alongside a duplicate
Clients list. Existing ids and files remain intact. Keep generic marketing/email/SMS/push as fallbacks.

Priorities below are design recommendations, not market-share claims. Existing stencils get profiles before
new artwork. Add Iterable first (owner's concrete integration), then Braze/Segment and the commerce providers.
Okta/Auth0 remain in Security & config for identity dependencies, with API search aliases and flow capability.

| Vendor / priority              | Rate, concurrency or quota evidence (checked 2026-10-14)                                                                                                                                                                                                                                                                               | Failure modes / profile consequence                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Stripe**, existing           | Live global rate 100 operations/s; sandbox 25/s; endpoints default 25/s; live concurrency 50. Account/endpoint exceptions apply. [Rate limits][stripe-rl]                                                                                                                                                                              | 429 can mean global/endpoint rate, concurrency, resource-specific quota or lock timeout. Retry backoff must consider reason; 5xx/timeout is a separate fault assumption. Never suggest adding Stripe replicas.                                                                                                                                                                 |
| **Twilio**, existing           | REST concurrency numeric default **UNVERIFIED/account-specific**. Example sender delivery: Canada local number 1 segment/s, US/Canada toll-free 3, US/Canada/UK short code 100; campaign/account throughput varies. Queue holds up to 10 h of segments. [Queues][twilio-queues]                                                        | REST rejects 429/20429 before processing; accepted SMS can still queue/fail (30001 overflow, validity expiry). Keep API acceptance and downstream MPS separate; don't throttle every inbound API request to one message/s. [20429][twilio-429], [overflow][twilio-overflow]                                                                                                    |
| **SendGrid**, existing         | Mail Send `/v3/mail/send` up to 10,000 requests/s, ≤1,000 recipients/request; not all SendGrid endpoints. [FAQ][sendgrid-faq]                                                                                                                                                                                                          | 429 on endpoint limits; bad payload 4xx; accepted mail can later bounce or be suppressed. Distinguish API result and eventual email delivery. [Rate headers][sendgrid-rl]                                                                                                                                                                                                      |
| **Iterable**, new first        | Numeric rate limits are per endpoint and scoped per project/key/org in API Explorer. Explorer requires dynamic rendering; no numeric default was verified. Guessed 500 or 1,000/s = **UNVERIFIED**, keep unknown until entered from account/docs. [Getting started][iterable-api]                                                      | 429 with exponential backoff; server 500 includes queue/email failures. `/api/events/track` project limits are additive across callers. Also can **call your API** as a data feed: 10 s complete-response budget; retries eligible failures every 3 min, up to 5 attempts. That's a separate caller/source scenario. [Responses][iterable-errors], [data feeds][iterable-feed] |
| **Braze**, new                 | `/users/track` data-point contracts: burst 3,000 requests/3 s; other contracts negotiated. Up to 75 total update objects/request under current rules; legacy per-array rules differ. [Rate policy][braze-rl]                                                                                                                           | 429; bad JSON/oversized payload can be 400/413. Preserve workspace/company scope and contract in preset; 1,000/s is only an average of a burst window, not the complete policy.                                                                                                                                                                                                |
| **Salesforce**, existing       | Daily org allocation depends on edition/licences; Enterprise example 100,000 + 1,000/license per rolling 24 h. Production/sandbox concurrent calls lasting ≥20 s: 25; shorter calls not subject to that cap. [Allocations][salesforce-limits]                                                                                          | Daily allocation is soft; system protection can reject with 403 `REQUEST_LIMIT_EXCEEDED`. Keep rolling-day usage and long-call concurrency separate; not “100k/day = hard 1.16 req/s”. [Enforcement][salesforce-enforcement]                                                                                                                                                   |
| **Shopify**, new               | GraphQL Admin app/store cost budget: Standard 100, Advanced 200, Plus 1,000, enterprise 2,000 **points/s**; single query ≤1,000 points. [GraphQL limits][shopify-rl]                                                                                                                                                                   | Use points/request and returned throttle cost. GraphQL errors can arrive in HTTP 200, so `THROTTLED` is a failed operation; separate REST/variant-creation throttles can be 429. [GraphQL status][shopify-status]                                                                                                                                                              |
| **OpenAI**, existing           | RPM/TPM and sometimes daily/shared-model quotas per org/project/model/tier. Build standard table's Astra/Sol/Terra 5,000 RPM and 1,000,000 TPM is a dated preset, not universal. [Limits][openai-rl]                                                                                                                                   | 429 may mean temporary rate cap or billing/quota; 503 overload may carry Retry-After. Unsuccessful attempts also consume rate budget. Report binding bucket, not replicas.                                                                                                                                                                                                     |
| **Anthropic/Claude**, existing | Start Opus/Sonnet 4.x examples 1,000 RPM / 2,000,000 ITPM / 400,000 OTPM; cached input accounting varies by model class. [Limits][anthropic-rl]                                                                                                                                                                                        | 429 with Retry-After; sharp growth can hit acceleration limit; 529 overload; streaming error can occur after HTTP 200. [Errors][anthropic-errors]                                                                                                                                                                                                                              |
| **Okta/Auth0**, existing       | Okta org concurrency 75 (Integrator Free 35); credential/token per-user limit 4/s for specified flows. Auth0 Free `/oauth/token` 30/s with burst 30 **and** overall Authentication API 300/min with burst 300; native social/token-exchange paths differ. [Okta concurrency][okta-conc], [per-user][okta-rl], [Auth0 Free][auth0-free] | 429; named user/client/tenant buckets. Token caching and refresh can reduce load; dependency-only identity edges consume no simulated requests. Don't apply the 4/s user safeguard as total org RPS.                                                                                                                                                                           |
| **PayPal**, new                | Vendor explicitly does **not publish** numeric rate policy. Numeric preset **UNVERIFIED**, user supplies contracted/measured cap. [Rate guidelines][paypal-rl]                                                                                                                                                                         | 429 `RATE_LIMIT_REACHED`; prefer webhooks over polling and cache tokens. Unknown quota must not be represented as a guaranteed unlimited service.                                                                                                                                                                                                                              |
| **Adyen**, new                 | No universal numeric payments RPS verified; preset **UNVERIFIED**, enter account/endpoint contract. [HTTP statuses][adyen-status]                                                                                                                                                                                                      | 429, validation 422, transient 503; duplicate idempotency key still in progress can be 409/422 with error 704, idempotency store failure 503/703. Retry only according to transient-error guidance. Payment refusal can be a business result in a successful HTTP response. [Idempotency][adyen-idempotency]                                                                   |
| **Segment**, new               | HTTP tracking: recommendation ≤1,000 requests/s/workspace; max 32 kB normal request/event, 500 kB batch; batch ≤2,500 events. [HTTP source][segment-http]                                                                                                                                                                              | May queue or reject 429 with retry headers; a 200 can still hide event rejection (e.g. overlarge event count). Ingest acceptance ≠ arrival at all destinations; model destination limits separately.                                                                                                                                                                           |

**Icons and licensing:** [`docs/ICONS.md`](../ICONS.md) already records reusable artwork for Stripe (Simple Icons
CC0), Twilio/SendGrid/Salesforce/OpenAI/Claude/Okta/Auth0 (existing catalogue assets with recorded attribution).
CC0/MIT artwork does not waive trademark rights. Reuse those local assets and nominative names, without new logos.
For Iterable, Braze, Segment, Shopify, PayPal and Adyen this research has **not verified a specific redistributable
asset**. New stencils should initially use existing ISC Lucide cloud/megaphone/card glyphs with vendor names; no
licensing claim is necessary to ship the behaviour. Braze's brand icon was explicitly rejected in ICONS.md for lack
of a clean grant; this plan does not reverse that. A later artwork PR must identify exact upstream file/version,
licence, attribution and trademark restrictions in ICONS.md. Public SVG download or a marketing brand page is not
a redistribution licence. [Lucide licence][lucide-license], [Simple Icons disclaimer][simpleicons-license].

### 4.2 Optional endpoints and OpenAPI

An API node works immediately without endpoints. **Endpoints** is a collapsed inspector section with “Add endpoint”;
the first endpoint does not redirect existing whole-node calls. `POST /charges` or `POST /api/events/track` is an
address **inside** the target node, not another canvas node. An endpoint has its own mean/tail latency, request or
cost quota, and error probability, inheriting omissions from the parent. Requests without a target use the node's
default behaviour. A generic `POST /charges` example is not a claim about Stripe's preferred API; a Stripe payment
example can use `POST /v1/payment_intents`.

Select “Target endpoint” in the connection inspector or the node's Calls row. The edge keeps its business label;
its secondary label/tooltip shows method/path. Endpoint identity is a stable opaque id scoped to the target node,
not path text, so rename is safe. Delete offers Retarget to API default or another endpoint and lists affected
connections, all in one undo step. An import with a dangling endpoint reference warns and disables that request's
planning result; it must not silently resolve to a different endpoint.

Node/global and endpoint quotas apply **together**, not one replacing the other. Shared account/project quota groups
can bind calls to two visual nodes representing the same API. Creating a second Stripe stencil doesn't double an
account's quota. Advanced scope identifiers are local labels, never API keys. In a simple diagram the inspector
shows one rate plus a hint “also shares the Stripe live account quota”.

OpenAPI import belongs in the existing Import surface and runs locally in a worker, as the other structured imports
do. Import selected paths/methods, summary, operationId, server labels and success/error classes. Import a **selected
API node plus endpoint records**, not 300 endpoint nodes and invented callers. [OpenAPI 3.1.1][openapi] describes
paths, operations and extensions; it does **not** specify observed latency, service capacity or failure probability.
Fill those only from an optional, documented `x-livediagrams-sim` extension or user measurement. A documented 429
response is a possible outcome, not a 1% error rate.

Proposed importer bounds: 5 MiB local file, 500 selected operations, bounded text/arrays/depth and reference visits;
reuse the repo's hostile-input parsing budgets. Accept OpenAPI 3.0/3.1 JSON/YAML first; Swagger 2 and 3.2 later.
Resolve local `$ref` with cycle detection, reject/flag unresolved external refs; no network fetching, server calls,
“Try it”, credentials, callbacks execution or remote logos. Reimport matches operationId then method/path, preserves
ids and explicit measurements, previews deletes/retargeting, and commits one undoable edit. User descriptions are
plain text, never injected HTML; URLs are descriptive only.

### 4.3 Proposed TypeScript contracts

These are **design sketches only**, extensions to `DiagramNode.props`, `DiagramEdge.props` and a typed model block
on `DiagramFile`. Existing node/edge ids and `diagrams/v1` remain. The profile metadata and education content are
app assets, not copied into every diagram; explicit measurements and pinned behaviour are saved.

```ts
type QuotaUnit =
  | "requests"
  | "records"
  | "tokens"
  | "inputTokens"
  | "outputTokens"
  | "costPoints"
  | "bytes"
  | "readUnits"
  | "writeUnits";

interface Quota {
  id: string;
  unit: QuotaUnit;
  amount: number; // finite positive; unset object = unknown
  windowMs: number; // positive; RPS is amount over 1000 ms
  algorithm: "token-bucket" | "fixed-window" | "rolling-window" | "planning-target";
  burst?: number; // capacity in the SAME unit; not concurrent calls
  sharedGroup?: string; // reference to one diagram-scoped quota definition
  // Real data, not derived by dividing daily allocation into steady RPS.
}

type LatencyDistribution =
  { kind: "constant"; meanMs: number } | { kind: "histogram"; buckets: { durationMs: number; share: number }[] };

interface ApiBehaviour {
  latency?: LatencyDistribution;
  errorRate?: number; // 0..1 transient per-attempt fault assumption
  quotas?: Quota[]; // endpoint quotas ADD to global quotas
  maxInFlight?: number;
  responseBytes?: number; // nonnegative, measured or assumed average
  costPerRequest?: Partial<Record<QuotaUnit, number>>;
  // Business refusal/validation/HTTP-200 operation errors are separate outcome classes.
}

interface ApiEndpoint {
  id: string; // stable under method/path rename
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
  path: string; // e.g. /charges; starts with /; bounded plain text
  label?: string;
  operationId?: string;
  behaviour?: ApiBehaviour;
}

interface RetryPolicy {
  maxAttempts: number; // includes first attempt; default 1 = no retry
  backoffMs: number;
  strategy: "fixed" | "exponential";
  jitter?: number; // 0..1
  retryOn: ("throttled" | "transient" | "timeout")[];
  idempotent?: boolean; // declared modelling assumption, not proven by method
}

interface PlanningEdgeProps extends EdgeSimProps {
  // group, share, dlq, filter, emits, deny, travelMs remain the canonical existing keys.
  consumer?: {
    parallelPerReplica?: number; // cap on shared node slots
    failurePolicy?: "requeue" | "inplace" | "skip";
    retry?: RetryPolicy;
    prefetch?: number;
  };
  producer?: { messageBytes?: number; batchRecords?: number; retry?: RetryPolicy };
  endpointId?: string; // Request only; belongs to edge.to
  caller?: {
    deadlineMs?: number;
    retry?: RetryPolicy;
    poolConnections?: number; // outbound caller pool, distinct from target connections
  };
  networkDelayMs?: number; // one-way physical delay, independent of animation
}

interface PlanningNodeProps extends NodeSimProps {
  preset?: string;
  presetRevision?: string;
  scaling?: "fixed" | "auto";
  maxConcurrency?: number;
  querySlots?: number;
  connections?: number;
  hitRate?: number;
  lockMs?: number;
  visibilityMs?: number;
  everyMs?: number;
  perRun?: number;
  executionTimeoutMs?: number;
  endpoints?: ApiEndpoint[];
  api?: ApiBehaviour;
  // Other family fields in 2.3 get separate bounded schemas as their batch lands.
}

interface PlanningModel {
  revision: "planning/v1";
  sharedQuotas?: Quota[]; // ids unique here; references use sharedGroup
  assumptions?: { target: string; field: string; note: string }[];
}
// Proposed DiagramFile extension: planning?: PlanningModel
// No planning block means legacy resolution; upgrading is explicit.
```

A shared quota reference uses the group's definition as authority; differing duplicate amount/window definitions
are rejected, not whichever node resolves first. Standalone quotas belong to a node/endpoint. Admission charges
every applicable bucket atomically only once per attempt; sampled dots consume their represented real units,
not one token per dot. Retries consume new attempts. Endpoint rate and sampled latency are not duplicated onto
the edge; resolution looks up target → endpoint and combines global limits. Declared consumer policies cannot
override a broker's retention or hard delivery cap.

Don't overload existing `latencyMs` (mean processing time) with “p50”. A two-number mean/p95 editor needs a named
distribution fitting rule or imported histogram; p95 alone doesn't determine a distribution. First batch keeps
constant/current jitter lesson semantics, later imports measured bounded histograms. Don't persist vendor sources
as executable URLs; provenance is metadata with scheme validation.

### 4.4 File-format and rollout migration

1. Extend types, `diagramSchema.ts`, `simProps.ts`, parser/serializer/ops, AI schemas and exported viewer together;
   regenerate with `pnpm schemas`. Today `props` accepts additional keys, but only known keys are validated:
   adding TypeScript alone would leave hostile endpoint arrays unbounded. Bounds for all interfaces above are
   mandatory (e.g. ≤500 endpoints/node, unique ids, ≤200-character path, ≤32 histogram buckets, sums = 1,
   ≤16 quotas/behaviour, finite nonnegative delay, bounded retry attempts); enforce reference integrity.
2. Files without `planning` stay on the **legacy resolver**, including omitted props. New diagrams save
   `planning.revision` and pinned preset revisions; materialise behaviour-critical defaults when choosing a preset
   so a documentation refresh cannot change playback. Preserve “unset/unknown” explicitly rather than filling a
   fabricated cap. Never write `Infinity` to JSON. Presets are immutable once referenced by saved files.
3. Upgrade existing diagrams through one inspector/context action with a change preview: affected nodes, old/new
   capacity, retry/DLQ meaning, any inferred relationship change. One undo step. Keep original node/edge overrides
   and sim setup/live precedence. Model-aware saved simulations and compare results pin the revision too.
4. **Additive v1 is a forward-compatibility risk.** An older app/viewer may preserve some unknown props yet execute
   legacy semantics or drop the top-level planning block. Do not claim transparent round-trip. Update every supported
   reader before publishing new files; show unsupported revision warnings and offer legacy export with a loss report.
   If that warning cannot be made reliable for old clients, use a `diagrams/v2` writer for planning documents instead;
   make this decision in P1 before shipping model-enabled files.
5. Regression fixtures: old file plays identically; upgraded file round-trips endpoints and groups; two APIs share
   one quota; endpoint rename keeps references; delete/undo restores references; malformed rates/ids/deep imports
   reject; downgraded export lists every discarded feature. Agent ops can add/target endpoints explicitly, never
   infer a real API key. Update the generated skill and site's fresh viewer; if the released viewer is stale when
   code ships, run `pnpm skill:release` per repository rules.

## 5. Planning features: value against complexity

Ranks are product judgement, not measured adoption. S ≈ one focused PR, M ≈ several interacting modules, L ≈ new
semantics/UI with multiple PRs. All reports show assumptions, scope and model revision; browser-only computation in
a bounded worker, no vendor API access and no backend.

| Rank | Feature and value                                                                                                   | Effort / dependencies                                                                                                            | Honest result                                                                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Capacity and explanations:** required replicas/shards/units and binding vendor quotas; answers “will it keep up?” | M; shared resolver and sim-flows 1–9 for truthful limits                                                                         | Throughput/headroom under stated steady workload; shared slots and retry cost. Store capacity needs a measured curve; caller blocking under slow dependencies needs item 10.                                           |
| 2    | **Headroom / what breaks first:** vary source rates together and name the first binding resource                    | S–M after rank 1                                                                                                                 | First bottleneck and traffic multiplier, with unknown limits listed; no false “infinite headroom”.                                                                                                                     |
| 3    | **What-if comparisons:** baseline vs scenario (replicas, partition/unit count, rate, outage)                        | M; use existing Simulation setup/multipliers, deterministic seed                                                                 | Throughput, rejected work, lag slope, drained backlog and required size in the same run. Latency/failure propagation comparison waits for item 10.                                                                     |
| 4    | **End-to-end latency budget p50/p95:** explains checkout budget and slow dependencies                               | M unloaded path estimate; L under load; item 10 prerequisite for truthful request completion, caller waits, timeouts and retries | Initial “unloaded service-time estimate”, not observed p95/SLO. Later measured root-request completion percentiles with sample count, warm-up, scope and timeout population.                                           |
| 5    | **Growth projections:** when headroom runs out at expected monthly growth                                           | S after capacity/compare                                                                                                         | λ(t) = λ₀(1+g)^t; for headroom H>1 and g>0, months to binding = log(H)/log(1+g). Scenarios at low/base/high assumptions. Constant mix/capacity, not a demand forecast.                                                 |
| 6    | **Cost hints:** show units, invocations, token/byte volume and GB-seconds                                           | M for drivers; L/ongoing upkeep for dollars                                                                                      | User-entered price × units, currency/Region/date and included allowances; no live quote or automatic plan recommendation. Request duration charges require accurate completion semantics where billing includes waits. |

For Orders at 3 req/s with one replica, four slots and 4 s work, nominal capacity is 1 req/s. Required replicas for
target utilisation u are `ceil(λ × meanSeconds / (parallel × u))`: 3 at 100%, 4 at 80%, **6 at 50%**. “Under 1.3 s”
only reaches near 100% utilisation on one replica; at 50% the duration must be ≤0.667 s. Show the chosen target and
the arithmetic, not an unexplained factor of two. With a broker input, first check partitions and aggregate node
budget; with a vendor quota, extra replicas may worsen throttling. A load balancer routes replicas but adds no
processing capacity itself.

For end-to-end budgets, serial work adds durations; parallel branches use the completion dependency's maximum;
async publish completion and eventual consumer completion are **different objectives**. Cycles and unspecified
completion dependencies need an explicit limit/unknown result. Do not add per-hop p95s and call the sum a path p95:
percentiles don't compose that way. Sample joint paths using the same seed and measured distributions; correlated
tails require a stated scenario, not independence by accident. Animation travel time stays separate.

Until item 10 is approved, report target-side work and unloaded paths only. Even successful HTTP animation does
not prove the root caller received a successful reply; down/slow API failures, connection pool exhaustion, retry
amplification and timeout-driven SLO misses remain unsupported. Gate those features in the phase plan, never
silently implement item 10 as part of “planning”.

## 6. Education per stencil

### 6.1 Content contract and coverage

Each entry is a concise, original explanation, not copied vendor documentation. It includes:

- **What it is:** 2–3 sentences, purpose and boundary (e.g. a Kafka topic isn't a queue that deletes after reads).
- **Key concepts:** 3–6 short definitions. F5: pool, pool member, health monitor, virtual server, iRules.
- **How it connects:** incoming/outgoing flows vs dependencies and the capabilities they enable.
- **What to watch for:** one or two common failure/bottleneck patterns and the model's actual limitation.
- **One curated overview link:** product publisher, anchored to an approachable overview where possible; factual
  citations/default evidence can be internal metadata linked from field provenance, not a wall of external links.

All 204 existing stencils get coverage, plus new API stencils. A family entry suffices for language variants,
generic clients/shapes and decorative infrastructure, but their name, connection guidance and limitations must
be correct. Use product overrides for meaningful differences: Kafka vs SNS, ALB vs NLB, SQL vs Redis, Lambda vs
container, Stripe vs Iterable. No undocumented “about 170” target that leaves the remaining catalogue blank.
Start with the **ten fully written entries** in [`stencil-education-sample.md`](stencil-education-sample.md), then
broker/compute/data/network/telemetry/security/client families. Config/security entries explain dependency meaning
even with no simulation controls; tools explain deployments/runs, not fake RPS.

For the F5 sample, the editorial evidence is explicit: [pool/member and virtual-server mapping][f5-pools],
[health monitor behaviour][f5-monitors] and [event-driven iRules][f5-irules]. The sample's one curated link goes to
the Basics overview; these detailed references belong in source metadata, keeping the user-facing entry compact.

```ts
interface EducationEntry {
  id: string; // family or product id
  whatKey: string; // 2–3 sentence translated paragraph
  concepts: { termKey: string; definitionKey: string }[];
  connectsKey: string;
  watchKey: string;
  overview: { titleKey: string; url: string };
  sources: { claim: string; url: string; checked: string; productVersion?: string }[];
}
interface Explanation {
  messageKey: string;
  values: Record<string, string | number>; // safe parameters, not prebuilt English
  evidence: "configured" | "observed" | "estimate";
  fixes: { actionId: string; targetId: string; labelKey: string }[];
}
```

Education is product knowledge; `Explanation` is diagram knowledge computed from the same resolved inputs and
shared planner that powers checks. Its output is a structured reason with real-unit arithmetic, contributors and
fix descriptors. Never duplicate planner calculations in a hover component. Vendor facts have review dates and
versions; teaching examples are labelled assumptions. A freshness audit flags stale/unverified evidence before
shipping a default, rather than silently fetching documentation when a person opens a diagram.

### 6.2 Three existing surfaces, no new chrome

| Surface                                                    | Content / interaction budget                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node hover card** (edit/live, keyboard focus equivalent) | What-it-is excerpt and one current behaviour sentence, plus “About…” opening the inspector. Live numbers lead. No scrolling textbook or new floating button. One secondary overview link only if the card remains stable, focusable and open while pointer enters it. |
| **Inspector About**                                        | Collapsed after Simulation/Connections, below actionable checks. Full entry, key concepts, how it connects, watch-for and the one link. Remember expansion; never move keyboard focus after lazy load. Explanation is above About because it concerns this node now.  |
| **Library/stencil preview**                                | Full entry alongside today's three node renderings; generic simulation role replaced by accurate family behaviour and supported settings. One primary action remains Add to current diagram; New diagram stays secondary. Same content keys as inspector.             |

Hover is a convenience; keyboard, touch and screen-reader users get all content through the inspector and library.
No “learn mode”, always-visible question marks on 204 nodes or extra top-bar control. At 1280×800 the main inspector
settings and one connection row must fit before long prose; About remains folded.

### 6.3 Contextual explanations, numbers and actionable fixes

Configured example (not a vendor promise):

> Orders handles ~1 req/s (1 replica × concurrency 4 / 4 s) but receives 3 req/s from Checkout through F5.
> Waiting work grows by about 2 req/s. At a 50% utilisation target, use 6 replicas or reduce processing time to
> ~0.67 s. The existing F5 can route to those replicas.

Live variant uses **observed** arrival/completion rates and lag slope once enough simulation events exist; label
“estimated” before then and avoid a misleading Healthy line when the observed queue grows. A steady-state estimate
is not the current run's measurement. Per-connection contributors say which group/endpoint is limited.

Other templates: “Only 3 of 8 Kafka readers in billing can be assigned because orders has 3 partitions”; “Payments
hits Stripe's endpoint quota before the global quota”; “There is no named subscription reading this topic”; “F5
is waiting for its probe threshold, so traffic can still reach the failed member”; “Iterable calls this data feed
as part of campaign sends, so increasing inbound notification throughput can overload your service”. Only render
an explanation whose implemented model supplies the evidence. That last example is guidance until data-feed traffic
is explicitly configured; don't infer live campaign volume.

Fixes come from the action registry/shared planner and are undoable. Ask no permission for an in-app reversible fix,
but never apply it automatically while reading About. Show one recommended fix; alternate fixes inside inspector
or context menu. “Increase vendor quota” is a documentation/planning suggestion, not a button that changes an
account. “Reduce retry attempts” appears only when caller semantics are supported.

### 6.4 Banner, callout and checks: divide the work

| Surface                          | Responsibility                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live status banner/bar           | Run-level state: paused, replaying, status summary and navigation to trouble. No per-vendor lesson.                                                                            |
| System callout                   | Most urgent observed trouble and **one** action (Revive, Add consumer, Apply capacity fix). Names the affected node; doesn't repeat every inspector explanation.               |
| Node hover/inspector explanation | This node's arithmetic, upstream contributors, binding connection/group/endpoint, supported alternatives and uncertainty.                                                      |
| Architecture checks              | Static structural risks/configured capacity with the existing ignore/off model; actionable findings, not tutorials. Same reason/fix ids as live planner when evidence matches. |
| About / library education        | Stable concepts, connections, limitation and curated overview; no alert tone or changing counters.                                                                             |

Don't introduce a second warning engine inside education. A check may warn about an absent DLQ while live says
the current run is healthy: those are different evidence scopes and must be labelled, not “resolved” by hiding one.

### 6.5 Lazy loading and i18n

Use the existing `loadOnce`/`lazyComponent` infrastructure: tiny stencil→family/id map in catalogue; full prose and
translations dynamically imported per family **on intent** (stable hover/focus, inspector About open, library
preview). No barrel import of all education entries from catalog/defaults/checks. Engine-safe profile numbers
remain separate from localized prose. Cache successful loads; in-place loading/error/Retry, Esc still closes
overlay; no layout shift that moves a button under the pointer. `bundleSplit.build.test.ts` must pin the content
outside both startup and canvas first-view chunks; `pnpm size` verifies entry budget. Static HTML export can embed
selected diagram entries only when explicitly exported, never all 204 by default.

The requested `docs/I18N.md`, `src/i18n/en.ts` and `pnpm i18n check` are **absent on this branch at d420d98**.
Do not claim an existing pipeline or add app code in this research PR. Implementation batches must depend on the
i18n foundation (or re-read its docs once merged). All new UI **and education prose** must use `t()` keys in the
English catalogue and checked locale bundles. Suggested namespaces: `education.f5.what`,
`education.kafka.concepts.partition`, `explain.capacity.sharedPool`. Sources, units and vendor names are metadata;
sentences are translated with typed placeholders, plural rules and locale number formatting, never concatenated
English fragments. Preserve user labels and endpoint paths as literal data; escape them and format numbers in real
units once. The sample is English editorial source material for those keys, not hard-coded UI text.

## 7. Phasing: reviewable PRs

Items 1–6 in sim-flows are **being built**, not assumed available on this branch. Items 7–9 are approved next;
this plan can structure that work without enlarging its approved scope. **Item 10 is not approved.** P1–P3 below
are proposed PR boundaries; later work needs review of this research, not implicit authorization from this document.
Each code batch ends with test/revert proof and a UX review against the chrome budget. Effort labels mean
scope, not promised dates; split a PR when it stops being reviewable.

| Batch                                                  | Value / scope                                                                                         | Effort                                       | Dependencies / exclusions                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **P1: profiles, capability readout and explanations**  | One shared resolver; human-readable “why” and appropriate fields, no new vendors                      | M                                            | Merge sim-flows 1–6; i18n foundation; settle v1/v2 warning strategy. No new request wait semantics or new controls with no effect. |
| **P2: broker kinds**                                   | Kafka vs fan-out pub/sub becomes accurate, correct assignment/headroom and vendor vocabulary (item 7) | M                                            | P1; approved item 7. No keys/order/share groups or broker delivery overhaul.                                                       |
| **P3: managed compute and external admission**         | Lambda capacity and API quotas use the right limits/fixes (item 8)                                    | M–L; split serverless and quota PR if needed | P1, P2 for SNS→Lambda acceptance; approved item 8. No outbound timeout/retry propagation.                                          |
| P4: broker failure policy                              | Kafka client retry vs Service Bus built-in DLQ vs SQS visibility (item 9)                             | M                                            | P1/P2 and approved item 9; separate fixture for each broker/client combination.                                                    |
| P5: external discovery + six vendors                   | Find generic API and Iterable; verified profiles or explicit unknown rates; reusable glyphs           | S–M                                          | P3; icon audit; no endpoint editor yet. Can ship discovery alone without waiting for quotas.                                       |
| P6: endpoint contracts + editor                        | Target per-endpoint behaviour and preserve references/undo/schema/export                              | M                                            | P1 compatibility decision, P3 quota groups; no actual HTTP calls. Split model/engine and editor when large.                        |
| P7: OpenAPI import                                     | Turn a local spec into useful optional endpoints                                                      | M                                            | P6, importer budgets; extensions are assumptions; no remote fetch or credentials.                                                  |
| P8: education surfaces, first ten entries              | About/hover/library shared content, accessible and lazy                                               | M                                            | P1 explanation model, i18n; no new engine semantics. Editorial work can proceed in parallel conceptually, without blocking P2–P7.  |
| P9a–f: family education + measured store/edge profiles | Complete catalogue coverage, stores/cache/probes become planning constraints                          | One S–M PR per family                        | P8; implement each field before showing it. Workload-specific size presets, not all vendor numbers at once.                        |
| P10: capacity/headroom/compare/growth                  | Planning readouts and scenario outcomes with assumptions                                              | M, divided by feature                        | P2–P6 and relevant P9 profiles; dependency latency limits still apply.                                                             |
| **Approval gate: request/reply semantics**             | Failures propagate, caller holds slots, deadlines/retries/pools                                       | L staged PRs                                 | **Requires separate approval for sim-flows item 10**; not part of P1–P10.                                                          |
| P11: root latency budgets p50/p95                      | Under-load request completion and SLO comparisons                                                     | L                                            | Approved/implemented item 10, measured distributions, bounded completion history.                                                  |
| P12: cost drivers and optional prices                  | Rough operating-cost comparisons                                                                      | M then ongoing upkeep                        | P10; regional dated/user prices, accurate units; no live billing integration.                                                      |

### P1 in detail: the common model and the first useful explanation

**Deliverable:** a node with today's processor settings explains its throughput and who sends it traffic. Inspector
read-only Connections rows derive Consumes/Publishes/Calls and only display applicable existing settings. Profiles
centralise behaviour metadata and device presets; missing/legacy model keeps old playback. No 204-stencil rewrite.

**Work:** introduce explicit family mapping and resolver evidence/units; share it across engine, analysis, checks
and explanations. Keep node pool settings on node and `group` on edge. Add preset/revision schema and file warning
strategy, including an explicit upgrade path; don't switch old defaults on load. Provide the Orders arithmetic and
no-reader case using existing planner fixes. Integrate i18n before any new strings. Resolve `travelMs` versus physical
delay and store connection versus active-query slots in the contract now, even if their new controls land later.

**Acceptance:** legacy snapshots/round-trip unchanged; same node resolved identically in analysis/checks/playback;
one service consuming two topics shows two policy rows but one slot pool; HTTP-only service has no consumer fields;
removing/reconnecting an edge updates the view. Orders 3/s → 1/s explanation distinguishes three replicas at 100%
from six at 50%. Explanation real units don't multiply twice at scale. Every fix has a regression that fails when
temporarily removed; no absolute timing budgets. Production E2E uses only `data-testid`. UX review: no new top-bar
controls, one primary fix, keyboard access, at most five main fields. **Value:** the owner's concrete explanation
works before the long vendor catalogue is implemented.

### P2 in detail: partitioned logs versus subscriptions

**Deliverable:** profile-backed item 7. Kafka/Event Hubs/Kinesis cap assigned instances per group; SNS/EventBridge/
Service Bus Topic/Pub/Sub/Exchange fan-out doesn't acquire a Kafka partition limit. Inspector uses shards,
subscriptions and bindings correctly. Topic vs cluster wrapper is explicit. Preserve legacy diagrams until upgrade.

**Work:** implement partitioned metadata and group allocation once for engine/analysis; remove artificial broker
hop cap only for non-partitioned types; update group/replica explanations and fixes. Keep producer message-size
and ingest-unit metadata ready, but vendor hard ingest limits can ship with admission logic in P3/P9. Test named
subscriptions independently from queue competing readers. No Kafka keys, ordering, share-group delivery or retry
semantics overhaul (P4).

**Acceptance:** same-run SNS→8 Lambda workers can use all configured slots; 3-partition Kafka→8 readers assigns
only 3 reader instances in the named group; two groups each receive copies, queue readers compete, exchange→queues
fan-out; explicit `dlq` isn't treated as a subscriber. Static capacity and observed delivery agree after enough
events, using fake clocks/operation counts. Remove the partitioned distinction to demonstrate the test fails.
Schema/agent/viewer output and i18n keys remain consistent. UX review: Partitions never appears on SNS and no
“add partitions” fix there. **Value:** realistic consumer sizing and a clearer broker lesson without new chrome.

### P3 in detail: managed compute and external limits

**Deliverable:** item 8, with Lambda allocated/shared concurrency and versioned vendor quota presets; Stripe,
generic external API, API Gateway and model APIs process latency/errors and reject admission truthfully.
Live reports rejected/throttled separately from failed, dropped and blocked. Unknown limits remain unknown.

**Work:** enforce per-node/per-endpoint admission data with real units and atomic shared quota accounting; rate,
concurrency and token/cost budgets remain different units. Give serverless fixed/auto effective slots within its
allocation; no steady-state instant scaling claim unless explicitly simplified. Use measured/assumed duration
and preset limits for planning. Fix planner actions to name Increase allocation/Reduce calls instead of adding
replicas to a SaaS API. Keep consumer/client retry definitions ready but do not execute caller deadlines, retries
or cascade failures. External acceptance returning a visual reply does not promise upstream failure propagation.

**Acceptance:** one extra request over a deterministic token bucket rejects; bucket refill is simulation time,
not wall clock. Two visual APIs share one account cap; two endpoints consume both global and endpoint budget;
cost/token units bind before RPM when configured. At message scale >1 the same real workload has comparable
admission counts, with discretisation tolerance stated. Slow external latency hits concurrent limit even below
RPS; unknown PayPal/Iterable rate isn't “unlimited” in explanations. Lambda cap differs from source RPS; SNS workers
aren't Kafka-partition-bound. Temporarily disable admission to prove tests catch it. UX review: preset and at most
four main controls, unknown evidence visible, no ineffective retry/timeout buttons. **Value:** third-party limits
and managed compute become useful planning constraints; P4 then adds correct redelivery semantics.

### Research review: decisions rejected or deferred

- Universal “all services are consumers”, duplicate consumer stencils and per-input replica pools: relationships
  and shared node capacity already express the correct model.
- Every vendor limit converted to RPS, or every backend connection treated as an active query slot: loses units,
  scope and workload assumptions, often recommending a false fix.
- Guessing Iterable/PayPal/Adyen numeric defaults or resolving Front Door's conflicting pages silently: unsupported
  precision; use explicit unknowns/deployed values. Inherited UNVERIFIED candidates are recorded but not ship-ready.
- Separate canvas node for every endpoint, extra learn mode/top-bar control and always-open education: crowds the
  editor. Optional endpoints and existing context surfaces keep the simple path intact.
- Vendor logo downloads without a verified grant, full iRules/policy execution and remote OpenAPI “Try it”: unnecessary
  licensing/complexity/backend work for this browser-only planning goal.
- Silently implementing item 10, adding p95s, or multiplying SLAs into promised availability: incorrect semantics
  and unapproved scope. Gate request completion modelling separately; use measured distributions for path latency.
- Automatic dollar estimates and vendor hardware capacity claims from generic latency: high upkeep and false certainty;
  cost drivers and measured capacity have greater immediate value.

## Sources and verification notes

All vendor links supporting retained numbers were checked on 2026-10-14. Historical versions are identified in the
tables. Documentation conflicts and pages that did not expose a numeric value are marked explicitly. No accounts
were queried and no API requests were sent. The original draft's missing citations were replaced with this narrower
verified set; its other numeric candidates remain UNVERIFIED rather than becoming defaults by repetition.

[kafka-broker]: https://kafka.apache.org/42/configuration/broker-configs/
[f5-pools]: https://techdocs.f5.com/en-us/bigip-14-1-0/big-ip-local-traffic-management-basics-14-1-0/about-pools.html
[f5-monitors]: https://techdocs.f5.com/en-us/bigip-15-0-0/big-ip-local-traffic-manager-monitors-reference/monitors-concepts.html
[f5-irules]: https://techdocs.f5.com/kb/en-us/products/big-ip_ltm/manuals/product/bigip-system-irules-concepts-11-6-0/1.html
[kafka-intro]: https://kafka.apache.org/42/getting-started/introduction/
[sb-settings]: https://learn.microsoft.com/en-us/azure/templates/microsoft.servicebus/namespaces/queues
[sb-lock]: https://learn.microsoft.com/en-us/azure/service-bus-messaging/message-transfers-locks-settlement
[sqs-quotas]: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/quotas-messages.html
[ps-props]: https://cloud.google.com/pubsub/docs/subscription-properties
[ps-fail]: https://cloud.google.com/pubsub/docs/dead-letter-topics
[eh-scale]: https://learn.microsoft.com/en-us/azure/event-hubs/event-hubs-scalability
[kinesis-limits]: https://docs.aws.amazon.com/streams/latest/dev/service-sizes-and-limits.html
[k8s-deploy]: https://kubernetes.io/docs/reference/kubernetes-api/workload-resources/deployment-v1/
[lambda-conc]: https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html
[lambda-timeout]: https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html
[pg-conn]: https://www.postgresql.org/docs/current/runtime-config-connection.html
[ddb-warm]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/warm-throughput-scenarios.html
[cosmos-scale]: https://learn.microsoft.com/en-us/azure/cosmos-db/scaling-provisioned-throughput-best-practices
[cosmos-limits]: https://learn.microsoft.com/en-us/azure/cosmos-db/concepts-limits
[redis-clients]: https://redis.io/docs/latest/develop/reference/clients/
[s3-perf]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html
[sf-params]: https://docs.snowflake.com/en/sql-reference/parameters#max-concurrency-level
[cf-cache]: https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
[cf-dns-ttl]: https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/
[cf-workers]: https://developers.cloudflare.com/workers/platform/limits/
[r53-hc]: https://docs.aws.amazon.com/Route53/latest/APIReference/API_HealthCheckConfig.html
[r53-record]: https://docs.aws.amazon.com/Route53/latest/APIReference/API_ResourceRecordSet.html
[elb-routing]: https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html
[tm-monitor]: https://learn.microsoft.com/en-us/azure/traffic-manager/traffic-manager-monitoring
[tm-cli]: https://learn.microsoft.com/en-us/cli/azure/network/traffic-manager/profile?view=azure-cli-latest
[apigw-throttle]: https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html
[apigw-limits]: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-execution-service-limits-table.html
[apim-pricing]: https://azure.microsoft.com/en-us/pricing/details/api-management/
[alb-idle]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html
[alb-hc]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html
[nlb-hc]: https://docs.aws.amazon.com/elasticloadbalancing/latest/network/target-group-health-checks.html
[agw-probe]: https://learn.microsoft.com/en-us/azure/application-gateway/application-gateway-probe-overview
[agw-settings]: https://learn.microsoft.com/en-us/azure/application-gateway/configuration-http-settings
[afd-limits]: https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits#azure-front-door-classic-limits
[afd-troubleshoot]: https://learn.microsoft.com/en-us/troubleshoot/azure/front-door/troubleshoot-issues
[afd-config]: https://learn.microsoft.com/en-us/azure/frontdoor/how-to-configure-origin
[gcp-backend]: https://cloud.google.com/load-balancing/docs/backend-service
[nginx-core]: https://nginx.org/en/docs/ngx_core_module.html#worker_connections
[nginx-proxy]: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout
[nginx-upstream]: https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server
[haproxy-release]: https://www.haproxy.com/blog/announcing-haproxy-3-3
[haproxy]: https://docs.haproxy.org/3.3/configuration.html
[envoy-cb]: https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/cluster/v3/circuit_breaker.proto
[envoy-outlier]: https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/cluster/v3/outlier_detection.proto
[istio-perf]: https://istio.io/latest/docs/ops/deployment/performance-and-scalability/
[kong-rl]: https://developer.konghq.com/plugins/rate-limiting/
[kong-schema]: https://github.com/Kong/kong/blob/master/kong/plugins/rate-limiting/schema.lua
[traefik-rl]: https://doc.traefik.io/traefik/v3.3/reference/routing-configuration/http/middlewares/ratelimit/
[prom-config]: https://prometheus.io/docs/prometheus/latest/configuration/configuration/
[otel-batch]: https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/batchprocessor/README.md
[otel-memory]: https://github.com/open-telemetry/opentelemetry-collector/blob/main/processor/memorylimiterprocessor/README.md
[dd-logs]: https://docs.datadoghq.com/api/latest/logs/send-logs/
[dd-rates]: https://docs.datadoghq.com/api/latest/rate-limits/
[dd-metrics]: https://docs.datadoghq.com/api/latest/metrics/submit-metrics/
[ai-sampling]: https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-configuration/
[splunk-hec]: https://help.splunk.com/en/data-management/splunk-enterprise-admin-manual/9.0/welcome-to-splunk-enterprise-administration/configuration-file-reference/9.0.8-configuration-file-reference/limits.conf
[jaeger-sampling]: https://www.jaegertracing.io/docs/1.27/sampling/
[cw-quotas]: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_limits.html
[cw-api]: https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricData.html
[stripe-rl]: https://docs.stripe.com/rate-limits
[twilio-queues]: https://help.twilio.com/articles/115002943027
[twilio-429]: https://www.twilio.com/docs/api/errors/20429
[twilio-overflow]: https://www.twilio.com/docs/api/errors/30001
[sendgrid-faq]: https://www.twilio.com/docs/sendgrid/for-developers/sending-email/v3-mail-send-faq
[sendgrid-rl]: https://www.twilio.com/docs/sendgrid/api-reference/how-to-use-the-sendgrid-v3-api/rate-limits
[iterable-api]: https://support.iterable.com/hc/en-us/articles/41044692130196-Getting-Started-with-Iterable-s-API
[iterable-errors]: https://support.iterable.com/hc/en-us/articles/39629320560148-API-Response-Codes
[iterable-feed]: https://support.iterable.com/hc/en-us/articles/45728211053332-Creating-a-Data-Feed-Web-Service
[braze-rl]: https://www.braze.com/docs/api/api_limits
[salesforce-limits]: https://developer.salesforce.com/docs/platform/salesforce-app-limits-cheatsheet/guide/salesforce-app-limits-platform-api.html
[salesforce-enforcement]: https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage
[shopify-rl]: https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits
[shopify-status]: https://shopify.dev/docs/api/admin-graphql/latest#status-and-error-codes
[openai-rl]: https://developers.openai.com/api/docs/guides/rate-limits
[anthropic-rl]: https://platform.claude.com/docs/en/api/rate-limits
[anthropic-errors]: https://platform.claude.com/docs/en/api/errors
[okta-conc]: https://developer.okta.com/docs/reference/rl2-concurrency/
[okta-rl]: https://developer.okta.com/docs/reference/rl2-limits/
[auth0-free]: https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy/rate-limit-configurations/free-public
[paypal-rl]: https://developer.paypal.com/api/rest/reference/rate-limiting/
[adyen-status]: https://docs.adyen.com/development-resources/response-handling/
[adyen-idempotency]: https://docs.adyen.com/development-resources/api-idempotency/
[segment-http]: https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/http-api
[lucide-license]: https://github.com/lucide-icons/lucide/blob/main/LICENSE
[simpleicons-license]: https://github.com/simple-icons/simple-icons#disclaimer
[openapi]: https://spec.openapis.org/oas/v3.1.1.html
