# The diagrams/v1 file format

Planning uses `diagrams/v2` and `planning.revision` (`p1`, `p2`, `p3`, `p3-a1`, `p3-w1`).
Preserve existing revisions: the app's upgrade pins effective values and previews compatibility.
Unknown revisions are refused. Files are `<name>.diagram.json`; schemas are at
`https://www.livediagrams.dev/schema/diagram.v1.json`, `diagram.v2.json` and `stencils.json`.

P2 logs (Kafka, Event Hubs, Kinesis) cap each consumer group's active readers by partitions/shards.
Subscription brokers (SNS, EventBridge, Service Bus Topic, Pub/Sub, exchanges) use all instances:
each `group` gets a copy and its readers compete. Queue readers always compete; `dlq` never subscribes.
`kafka.cluster` is infrastructure. Producer sizes and ingest units impose no vendor ingest limits.
`networkDelayMs` is physical call travel in W1; store `connections`/`querySlots` remain metadata.

W1 Request callers execute `poolConnections` in both modes: blocking holds a thread while queued;
non-blocking frees it. Queued deadlines are never sent. HPA/KEDA metrics accept
`source: {kind: "pods", metric: "busyThreads"}`: `utilization.percentOfRequest` is percent of
Concurrency; `averageValue.value` is threads per pod. This is a modelled custom metric; ECS custom metrics remain unsupported.

## Top level

- `format` (required): `"diagrams/v2"` with `planning: { "revision": "p3" }` for new planning diagrams; `"diagrams/v1"` for legacy playback.
- `title` (required) and an optional `description` of one or two sentences.
- `color` (optional): the canvas background tint, using an annotation palette colour or hex (`#RGB`, `#RGBA`,
  `#RRGGBB` or `#RRGGBBAA`). Omit it for the theme's default background. Alpha is preserved.
- `direction`: `"LR"` (left to right, the default) or `"TB"` (top to bottom). The layout follows it.
- `nodes` and `edges` (required, may be empty), and optionally `groups`, `annotations` and `simulations`.
- `private`: `true` marks a Private diagram. The app keeps it on the device (no share links, no cloud saves, no
  AI tools) and it stays private when it's opened again. Keep the field as it is, never make a share link for
  it (`scripts/share-link.mjs` refuses) and don't upload it anywhere; hand the user the file or an Interactive HTML
  file (`scripts/export-html.mjs`, see [outputs.md](outputs.md)).
- `checks`: the architecture checks a person turned off (`"off": ["capacity"]`) or ignored for one element
  (`"ignore": [{ "rule": "dead-letter", "target": "<node id>", "reason": "..." }]`). Keep it as it is. Only the
  person decides it: never add entries to silence a finding; fix the design instead.

## Nodes

```json
{ "id": "orders", "stencil": "kafka.topic", "label": "Kafka", "sublabel": "orders.created", "group": "aks" }
```

- `id`: unique and stable, short kebab-case. Edges and simulations refer to it. Nodes, edges, boundaries and
  annotations share one id space: never give an edge a node's id (the app renames a repeated id when it opens
  the file).
- `stencil`: an id from [stencils.md](stencils.md). `validate.mjs` rejects unknown ids.
- `label`: the name people use. About 24 characters fit on the card; longer labels are cut off.
- `sublabel` (optional): the second line, such as a topic or queue name, a consumer group or the technology.
  It wraps onto two lines of about 28 characters.
- `x`, `y`: the card's top-left corner in pixels. Leave them out and run `scripts/layout.mjs`. If you place
  cards yourself, a card is 220 to 260 by 72 pixels. Left to right, columns are about 360 pixels apart and rows
  about 120.
- `group` (optional): the id of the boundary the node sits in.
- `props` (optional): simulation settings (see below).

## Edges

```json
{ "id": "e1", "from": "orders-api", "to": "orders", "kind": "async", "label": "OrderPlaced" }
```

- `from` and `to` are node ids. Draw the direction data flows: producer to topic, topic to consumer, service to
  database.
- `kind`: `"async"` for messages and events (a dashed line that animates in live view), `"sync"` for requests
  and responses such as HTTP, gRPC and SQL (a solid line). It defaults to `"async"`, so set it on every edge.
- `label` (optional): one to three words, usually a message type or a verb. Leave it out when it would repeat
  the target's name.
- `relation` (optional): leave it out for flows. A dependency is drawn dotted and never carries traffic:
  `config`, `secret`, `identity`, `telemetry`, `deploy` or `depends`. It points from the thing that needs it to
  the dependency, for example from a service to Key Vault. A `deploy` edge points from the pipeline to its target.
  Config and secrets are read at startup and refreshed, not on every request: make a service's edge to App
  Configuration or Key Vault a dependency, or every request flows through it in live view.
- `relationOrigin` (optional, written by the app): `inferred` when the relation came from the stencils at its ends,
  `explicit` when someone chose it. Changing a node's stencil re-infers its edges, except `explicit` ones.
- `props` (optional): simulation settings (see below).

## Boundaries (`groups`)

```json
{ "id": "aks", "label": "AKS cluster", "tone": "k8s" }
```

A boundary is a labelled box around the nodes whose `group` is its id: a cluster, a VNet or VPC, an account, a
region or a third party. `layout.mjs` sets its `x`, `y`, `width` and `height`. If you set them yourself, the box
must contain its members. Boundaries don't nest, and a node sits in at most one.

## Annotations

Annotations are documentation only, and the simulation never sees them. Use them sparingly:

```json
{ "id": "note-1", "kind": "note", "text": "Retried 3 times, then dead-lettered" }
```

`layout.mjs` places a `note` or `text` without a position in a row under the diagram. A `zone` (a dashed region)
and a `shape` (a plain outline, the only kind an edge may end on) need `x`, `y`, `width` and `height`.

## Values

<!-- BEGIN GENERATED enums -->

- Boundary `tone`: `azure`, `aws`, `gcp`, `k8s`, `onprem`, `neutral`
- Edge `kind`: `async`, `sync`; `relation`: `flow`, `config`, `secret`, `identity`, `telemetry`, `deploy`, `depends`; `sourceSide` / `targetSide`: `top`, `right`, `bottom`, `left`
- Annotation `kind`: `text`, `note`, `zone`, `shape`; `shape`: `rect`, `rounded`, `ellipse`, `diamond`, `cylinder`, `stadium`, `subroutine`, `dbl-circ`, `hexagon`, `lean-r`, `lean-l`, `trap-b`, `trap-t`, `sl-rect`, `notch-rect`, `lin-rect`, `div-rect`, `tag-rect`, `processes`, `delay`, `notch-pent`, `hourglass`, `fork`, `datastore`, `das`, `lin-cyl`, `bow-rect`, `flag`, `win-pane`, `doc`, `docs`, `lin-doc`, `tag-doc`, `bolt`, `comment`, `brace-r`, `braces`, `curv-trap`, `asym`, `f-circ`, `framed-circle`, `cross-circ`, `tri`, `flip-tri`; `color`: `white`, `neutral`, `yellow`, `green`, `blue`, `purple`, `red` or hex (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`; alpha is preserved); `textSize`: `s`, `m`, `l`, `xl`
- Limits: 5,000 nodes, 20,000 edges, coordinates within ±1,000,000

<!-- END GENERATED enums -->

## Simulation settings (`props`)

Every setting is optional, and live view works without any. Node `props`:

<!-- BEGIN GENERATED node-props -->

- `resources` (object): A1 measured/assumed CPU-ms per real attempt, CPU request/limit in millicores, memory in MiB, startup/grace; optional single container name; resources.modelRevision a2 opts generic Deployments into execution independently of controller mode, while unmarked A1 behavior stays fixed; atomic replacement. Effective fleet <=10000 and authored document lifecycle budget <=100000. Requires planning revision p3-a1.
- `autoscaling` (string or map): Node-owned HPA (a1) or KEDA 2.18 ScaledObject (a2) on p3-a1. KEDA broker bindings use node IDs plus exact groups; strict activation and separate poll/cooldown control zero, HPA owns 1-N. Kafka caps desired by partitions unless allowIdleConsumers. SQS delayed visibility and ScaledJob execution are unsupported. Per-trigger cache, fallback and rolling HPA behavior; <=16 triggers+metrics, intervals >=1000 ms. Atomic replacement; remap broker IDs on copy. Native serverless remains P3-owned. A3 (modelRevision a3) adds cloud controllers: ecs (target tracking on task CPU/memory % or ALB requests per task per minute bound to an aws.elb node with a sync flow; step scaling with CloudWatch alarm steps), aca (Container Apps HTTP requests/s rule plus KEDA event triggers; HTTP wakes zero on demand), appService (Azure Monitor rules: any out, all in, per-rule cooldowns, flapping deferral) and cloudRun (concurrency = node concurrency, 60% targets, on-demand wake, min 0). Check diagram and describe_diagram report scenario sizing (scalingPlans) from saved simulations, verified by a same-seed rerun.
- `resumeAutoscaling` (boolean): repeatable command: true resumes HPA after an authored replicas patch enters fixed override; not retained in engine state
- `api` (object): P3 admission: typed token buckets, concurrent calls, scoped account sharing, duration/errors and per-request token/cost sizes. Unknown budgets stay unknown. Every applicable bucket is charged atomically in real units.
- `endpoints` (string[]): P3 admission enforcement for optional endpoint records (id, method, path, behaviour). Endpoint budgets add to node/account budgets; authoring UI is deferred to P6.
- `scaling` ("fixed" | "auto"): serverless fixed slots or auto within maxConcurrency; auto explicitly assumes instant scaling and excludes cold starts
- `maxConcurrency` (number 0..10000): serverless allocated concurrent work, independent from source RPS; account allocation remains an additional cap
- `preset` ("processor-lesson" | "device-size" | "lambda-account" | "stripe-live" | "stripe-sandbox" | "api-gateway-account" | "managed-measured"): immutable preset id: processor-lesson (assumption) or device-size (existing approximate size preset); resolved values are pinned alongside
- `presetRevision` ("1" | "2026-10-14"): pinned preset revision (1 for P1); unsupported revisions are refused
- `connections` (integer 1..10000): store connection ceiling, distinct from active query slots; planning metadata, not enforced in P1
- `querySlots` (integer 1..10000): measured concurrent active queries; planning metadata, stores remain parallel in P1 playback
- `ingestUnits` (integer 1..10000): broker provisioned ingest units, in the profile's native unit; metadata only, no vendor hard ingest ceiling in P2
- `ratePerSec` (number 0..10000000): messages per second a source sends in free play (default 2)
- `latencyMs` (number 0..600000): time to handle one message (processor 250, gateway 60, store 40 by default)
- `concurrency` (number 0..10000): messages handled at once per replica (default 4)
- `replicas` (number 0..10000): instances (default 1)
- `jitter` (number 0..1): random spread of latencyMs (default 0.2)
- `failureRate` (number 0..1): chance that handling a message fails
- `retry` ("requeue" | "inplace"): "requeue" (default: back of the broker) or "inplace" (same slot, blocks it)
- `retryBackoffMs` (number 0..600000): delay before a failed message is redelivered
- `maxDeliveryCount` (number 0..10000): on a broker: attempts before a message is dead-lettered (default 3)
- `partitions` (number 0..10000): p2 partitioned logs only: instance assignments per group (Kinesis: shards); ignored by subscription/binding fan-out; legacy and p1 retain role-based limits
- `messageType` (string): what a source sends, e.g. "OrderPlaced"
- `emits` (string or map): a processor renames what it sends: "PaymentCompleted", or a map {"OrderPlaced": "PaymentRequested", "*": "Audited"}
- `size` ("branch" | "campus" | "datacentre"): network devices (routers, switches, firewalls, ADCs): "branch", "campus" or "datacentre", whose datasheet throughput and latency are the defaults
- `gbps` (number 0..1000000): network devices: throughput per unit in Gbps (default: the size preset's); any gateway given gbps gets this ceiling
- `messageKB` (number 0.01..1000000): average payload in kB: devices convert throughput with it (default 64); brokers retain producer-size metadata only, without a default or ingest ceiling
- `ha` ("standalone" | "active-standby" | "active-active"): network devices: "standalone" (default), "active-standby" (one unit carries traffic) or "active-active" (units add up); replicas = units
- `failoverMs` (number 0..600000): network devices: how long an active-standby pair stalls when a unit fails (default 1000)
- `healthChecks` (boolean): gateways: skip targets that are down (default true for ADCs, false otherwise)
- `trafficMix` (object): request routing R1, sources only: {mode: "shares", entries: [{routeId, share}]} (shares 0..1 add up to 1; ratePerSec is the total) or {mode: "rates", entries: [{routeId, ratePerSec}]} (the rows add up to the total; a stored ratePerSec stays dormant). Each message carries one route; saved traffic profiles and injections split by the same proportions. routeIds name planning.requestRoutes. Atomic replacement.
- `routeTable` (object): request routing R1, HTTP routers only (kong, azure.api-management, aws.api-gateway, nginx, envoy, traefik, haproxy, istio, aws.elb, azure.app-gateway, load-balancer, azure.front-door, cloudflare, generic.cdn, generic.adc, f5.bigip, netscaler.adc, gcp.cloud-load-balancing): {rules: [{id, label?, match: {methods?, path?: {kind: "exact"|"prefix"|"template", value}, hosts?, headers?, query?}, targets: [{edgeId, weight}], quotas?}], default?: {targets, quotas?}}. First match wins in order; Default only when no rule matches; no Default refuses 404 (route-not-found). A matched rule never falls through: no eligible target (filters, zero weights) refuses 404 (route-no-eligible-target). Weights (integers 0-10000) pick one connection per request with a seeded draw; a down target keeps its share. Targets are ordinary outgoing flows (connection ids, or batch keys in edit_diagram). quotas are requests-unit token buckets (429 when exhausted); a sharedGroup must match planning.sharedQuotas. Unaddressed Requests use Default only; unaddressed async messages keep round-robin. Bounds: 256 rules, 16 targets, 16 header/query entries. Atomic replacement.

<!-- END GENERATED node-props -->

Edge `props`:

<!-- BEGIN GENERATED edge-props -->

- `requestRouteId` (string): request routing R1: on a Request (sync) out of a source or service, the request route this call sends (planning.requestRoutes id); dormant on a router's connections
- `requestFilter` (object): request routing R1: only addressed requests matching {methods?, path?, hosts?, headers?, query?} travel this connection (a broker binding's routing key or header match); unaddressed messages don't match
- `endpointId` (string): Request target endpoint id inside the target API node; dangling references reject rather than fall back
- `caller` (object): reserved deadlineMs, retry policy and poolConnections contract; no caller waits, retries, deadlines or cascades execute in P3
- `group` (string): consumer group (logs), subscription (pub/sub), or binding (exchange); each name gets a copy and readers sharing a name compete; queues always compete
- `groupOrigin` ("inferred"): inferred: the default group follows the consumer node id when copied or reconnected; omit for authored group names
- `share` (number 0..1): chance that this fan-out edge gets a copy
- `dlq` (boolean): true marks a broker's dead-letter route (also inferred from a target labelled DLQ or dead-letter)
- `travelMs` (number 0..600000): time a message spends on the edge (default 300 for a message, 200 for a request); animation only, never a limit
- `networkDelayMs` (number 0..600000): physical one-way delay in ms (absent means unknown); metadata only in P1, never added to animation travelMs
- `emits` (string): renames messages on this edge
- `filter` (string[]): message types this edge accepts, e.g. ["Order*"] (a trailing * matches a prefix)
- `deny` (boolean): true makes the edge a deny rule: messages routed here are blocked at its source (counted as blocked, never dropped)

<!-- END GENERATED edge-props -->

Other keys in `props` are kept, so you can note facts such as `"replicationFactor": 3`.

## Boundary example

Run `layout.mjs` to position this diagram; `web` remains outside `aks`.

```json
{
  "format": "diagrams/v1",
  "title": "Orders",
  "groups": [{ "id": "aks", "label": "Order services", "tone": "k8s" }],
  "nodes": [
    { "id": "web", "stencil": "client.browser", "label": "Storefront" },
    { "id": "api", "stencil": "service.dotnet", "label": "Orders API", "group": "aks" },
    { "id": "orders", "stencil": "generic.database", "label": "Orders", "group": "aks" }
  ],
  "edges": [
    { "id": "call", "from": "web", "to": "api", "kind": "sync" },
    { "id": "save", "from": "api", "to": "orders", "kind": "sync" }
  ]
}
```

## Share links

Only make public share links when requested, never for a Private diagram. Use
`node scripts/share-link.mjs <file>`; see [outputs.md](outputs.md) for output choices.

A link with a password (`#e=…`, encrypted in the browser) is made only in the app, with **File > Share… > Link with
password…**. Don't build one, and never put a password in a link or in the same message as the link.

Chat apps may cut off links longer than about 8,000 characters. For those, hand over the `.diagram.json` file:
it opens at livediagrams.dev with **File > Open…**.
