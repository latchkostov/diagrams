# The diagrams/v1 file format

A diagram is one JSON file, `<name>.diagram.json`. This page covers what an agent needs. The full JSON Schemas
are published at <https://www.livediagrams.dev/schema/diagram.v1.json> (the file) and
<https://www.livediagrams.dev/schema/stencils.json> (every stencil).

## Top level

- `format` (required): always `"diagrams/v1"`.
- `title` (required) and an optional `description` of one or two sentences.
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
- Annotation `kind`: `text`, `note`, `zone`, `shape`; `shape`: `rect`, `rounded`, `ellipse`, `diamond`, `cylinder`; `color`: `neutral`, `yellow`, `green`, `blue`, `purple`, `red`; `textSize`: `s`, `m`, `l`, `xl`
- Limits: 5,000 nodes, 20,000 edges, coordinates within ±1,000,000

<!-- END GENERATED enums -->

## Simulation settings (`props`)

Every setting is optional, and live view works without any. Node `props`:

<!-- BEGIN GENERATED node-props -->

- `ratePerSec` (number 0..10000): messages per second a source sends in free play (default 2)
- `latencyMs` (number 0..600000): time to handle one message (processor 250, gateway 60, store 40 by default)
- `concurrency` (number 0..10000): messages handled at once per replica (default 4)
- `replicas` (number 0..10000): instances (default 1)
- `jitter` (number 0..1): random spread of latencyMs (default 0.2)
- `failureRate` (number 0..1): chance that handling a message fails
- `retry` ("requeue" | "inplace"): "requeue" (default: back of the broker) or "inplace" (same slot, blocks it)
- `retryBackoffMs` (number 0..600000): delay before a failed message is redelivered
- `maxDeliveryCount` (number 0..10000): on a broker: attempts before a message is dead-lettered (default 3)
- `partitions` (number 0..10000): on a topic or stream: the most consumers per group that can be active
- `messageType` (string): what a source sends, e.g. "OrderPlaced"
- `emits` (string or map): a processor renames what it sends: "PaymentCompleted", or a map {"OrderPlaced": "PaymentRequested", "*": "Audited"}
- `size` ("branch" | "campus" | "datacentre"): network devices (routers, switches, firewalls, ADCs): "branch", "campus" or "datacentre", whose datasheet throughput and latency are the defaults
- `gbps` (number 0..1000000): network devices: throughput per unit in Gbps (default: the size preset's); any gateway given gbps gets this ceiling
- `messageKB` (number 0.01..1000000): network devices: the average message in kB the throughput is converted with (default 64)
- `ha` ("standalone" | "active-standby" | "active-active"): network devices: "standalone" (default), "active-standby" (one unit carries traffic) or "active-active" (units add up); replicas = units
- `failoverMs` (number 0..600000): network devices: how long an active-standby pair stalls when a unit fails (default 1000)
- `healthChecks` (boolean): gateways: skip targets that are down (default true for ADCs, false otherwise)

<!-- END GENERATED node-props -->

Edge `props`:

<!-- BEGIN GENERATED edge-props -->

- `group` (string): consumer group, on an edge leaving a topic or stream: every group gets each message, edges in one group compete
- `share` (number 0..1): chance that this fan-out edge gets a copy
- `dlq` (boolean): true marks a broker's dead-letter route (also inferred from a target labelled DLQ or dead-letter)
- `travelMs` (number 0..600000): time a message spends on the edge
- `emits` (string): renames messages on this edge
- `filter` (string[]): message types this edge accepts, e.g. ["Order*"] (a trailing * matches a prefix)
- `deny` (boolean): true makes the edge a deny rule: messages routed here are blocked at its source (counted as blocked, never dropped)

<!-- END GENERATED edge-props -->

Other keys in `props` are kept, so you can note facts such as `"replicationFactor": 3`.

## A complete example

A Kafka order pipeline with a payment service and a dead-letter topic. Run `layout.mjs` and every node gains `x`
and `y`, and the boundary gains its box.

```json
{
  "format": "diagrams/v1",
  "title": "Kafka order pipeline",
  "description": "Checkout publishes orders to Kafka; payments and shipping consume them independently.",
  "direction": "LR",
  "groups": [{ "id": "aks", "label": "AKS · order services", "tone": "k8s" }],
  "nodes": [
    { "id": "web", "stencil": "client.browser", "label": "Storefront", "props": { "messageType": "OrderRequest" } },
    { "id": "orders-api", "stencil": "service.dotnet", "label": "Orders API", "group": "aks" },
    { "id": "orders", "stencil": "kafka.topic", "label": "Kafka", "sublabel": "orders.created", "group": "aks" },
    { "id": "payments", "stencil": "service.java", "label": "Payment service", "group": "aks" },
    { "id": "shipping", "stencil": "service.go", "label": "Shipping service", "group": "aks" },
    { "id": "stripe", "stencil": "stripe", "label": "Stripe", "sublabel": "Payment intents" },
    { "id": "dlq", "stencil": "kafka.topic", "label": "Kafka DLQ", "sublabel": "orders.dlq", "group": "aks" }
  ],
  "edges": [
    { "id": "e1", "from": "web", "to": "orders-api", "kind": "sync", "label": "POST /orders" },
    {
      "id": "e2",
      "from": "orders-api",
      "to": "orders",
      "kind": "async",
      "label": "OrderPlaced",
      "props": { "emits": "OrderPlaced" }
    },
    { "id": "e3", "from": "orders", "to": "payments", "kind": "async", "props": { "group": "payments" } },
    { "id": "e4", "from": "orders", "to": "shipping", "kind": "async", "props": { "group": "shipping" } },
    { "id": "e5", "from": "payments", "to": "stripe", "kind": "sync", "label": "charge" },
    { "id": "e6", "from": "orders", "to": "dlq", "kind": "async", "label": "after 3 tries", "props": { "dlq": true } }
  ]
}
```

## Share links

Anyone who has a link can open the diagram, so make one only when the user asked for a link, and never for a private
diagram ([outputs.md](outputs.md)). `scripts/share-link.mjs` builds the link. Without Node, build it the same way: take the diagram as minified JSON
(UTF-8), compress it with raw DEFLATE (RFC 1951, no zlib header), encode that as base64url without padding, and
append it to `https://www.livediagrams.dev/#d=`. In Python:

```python
import base64, json, zlib

diagram = json.load(open("order-pipeline.diagram.json", encoding="utf-8"))
text = json.dumps(diagram, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
deflate = zlib.compressobj(9, zlib.DEFLATED, -15)
payload = base64.urlsafe_b64encode(deflate.compress(text) + deflate.flush()).decode().rstrip("=")
print("https://www.livediagrams.dev/#d=" + payload)
```

A link with a password (`#e=…`, encrypted in the browser) is made only in the app, with **File > Share… > Link with
password…**. Don't build one, and never put a password in a link or in the same message as the link.

Chat apps may cut off links longer than about 8,000 characters. For those, hand over the `.diagram.json` file:
it opens at livediagrams.dev with **File > Open…**.
