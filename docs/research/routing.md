# Request routing: optional routes, traffic mixes and endpoints

Status: research and proposed design, checked **2026-10-14**. Docs only; no application behaviour changes.
Branch `research/routing`, fresh from `origin/master` at `aaa2dd7`. P1/P2 are implemented here; P3 external
admission is being merged and is a dependency, not an API this document claims already exists.

## Recommendation and scope

Extend **P6: endpoints and routing** in [planning-model.md](planning-model.md#4-external-apis-saas-and-optional-endpoints).
A request optionally carries a method/path address and a stable route identity. A source can generate a mix of
those routes; a gateway can select an outgoing connection through an ordered route table. A service can call a
specific route on another service through its Request connections. Endpoints are optional handlers inside the
destination, with their own behaviour and the parent's shared capacity. No additional canvas nodes are necessary.

Keep the current connection and simulation defaults until someone adds routing. Preserve broker subscriptions,
message-type filters, `emits`, independent fan-out `share`, and gateway round-robin when no route table exists.
Colour addressed traffic by route, with a non-colour marker and a compact legend. Reuse P3 admission and rejection
accounting for 404s and route quotas. Add Fastly in a later PR; Kong already exists.

This composes with [sim-flows-review.md](sim-flows-review.md#top-10-recommendations),
[autoscaling.md](autoscaling.md#recommendation-and-scope) and [SIMULATION.md](../SIMULATION.md).
The separate approval gate for caller waits, upstream failure propagation, deadlines and outbound retries remains
separate. A visual 404 reply is not an implemented end-to-end HTTP stack. No backend, vendor accounts, credentials,
remote configuration discovery or actual requests to modelled APIs are needed.

## 1. How real routers work

The following are vendor facts; the shared simulator model in §2 is our proposed abstraction. Vendor precedence,
rewrites, health policy and no-match responses must not be inferred from a product's stencil alone.

### Kong and Fastly

**Kong:** a Gateway Service describes an upstream application, including its destination; a Route matches requests
and selects a Service. Hosts, methods, paths and headers can constrain matching. Multiple Routes can expose the
same Service with different policies. Kong orders matches by priority: expressions use explicit priorities,
while traditional matching derives priority from criteria, including regex priority. It is not simply the order
of objects in an exported file. Routes also control path stripping and host preservation. Plugins can be scoped
to a Route or Service; the rate-limiting plugin rejects excess requests with 429. Model matching and scoped limits,
not the plugin execution engine. [Services][kong-services], [Routes][kong-routes], [Rate Limiting][kong-limits].

**Fastly:** a backend is an origin identified by hostname or address. Request conditions decide which backend
receives a request; the backend API describes highest-priority matching conditions. VCL can select `req.backend`,
usually in `vcl_recv`; directors/load balancing can distribute work among backends. Compute code instead chooses
a backend when issuing `fetch`, using a static backend name or a dynamic backend. Represent an origin as an
outgoing edge and selected conditions as rules. Do not execute VCL, Compute JavaScript or cache policy, or imply
that every request reaches origin rather than being served from cache. [Backends][fastly-backends],
[VCL backend value][fastly-vcl], [Compute JavaScript][fastly-compute], [Load balancing][fastly-balancing].

### Other routing systems

| System             | Real model and matching                                                                                                                                                                                                                                                                                                                                                                                  | Implication for Live Diagrams                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS API Gateway    | REST APIs have resources, methods and integrations; deployment stages select deployed API versions and appear in the invoke URL. HTTP APIs are a different API model. [Method requests][aws-methods], [Stages and invocation][aws-stages].                                                                                                                                                               | Method + resource template maps to a destination endpoint. Stage/base-path is explicit address or descriptive metadata, not a second service-capacity pool. Do not claim arbitrary header conditions are native REST resource selection. |
| AWS ALB            | Listener rules evaluate the lowest numbered priority first, with default last. Conditions include path, host, method, header and query string; actions include forwarding, redirects and fixed responses. Forward actions can weight target groups. An unhealthy weighted group does not automatically transfer its allocation to a different healthy group. [Rules][alb-rules], [Actions][alb-actions]. | Ordered matches and weighted outgoing edges express canaries. A default may forward or reject; weights describe alternative targets, not fan-out. Do not silently add cross-group failover.                                              |
| NGINX              | `location =` exact match wins; otherwise the longest matching prefix is remembered, then regex locations are considered in configuration order. `^~` suppresses the regex search for that selected prefix. `proxy_pass` sends selected requests upstream. [Locations][nginx-locations], [Proxying][nginx-proxy].                                                                                         | Exact/prefix rules cover the first useful subset. A generic first-match table is not native NGINX precedence; order equivalent explicit rules yourself and flag unsupported regex/rewrite imports.                                       |
| Envoy              | A virtual host is selected by domain; its routes are checked in order. Route matches support prefix, exact path and safe regex, with headers; actions choose a cluster or weighted clusters. [Matching][envoy-matching], [Route components][envoy-routes].                                                                                                                                               | Host + ordered rule + weighted destination is a close fit. Keep safe-regex support distinct from arbitrary JavaScript regex; regex is deferred here.                                                                                     |
| Istio              | `VirtualService` associates hosts with ordered HTTP routes; the first matching rule applies. URI, method, authority and header matches can use exact/prefix/regex. Destinations name services and optionally subsets, with weights for splits. [VirtualService][istio].                                                                                                                                  | Model mesh routing with the same rules and targets; a subset is an explicitly drawn destination/version, not a hidden replica fleet.                                                                                                     |
| Traefik            | HTTP routers match `Host`, `Path`, `PathPrefix`, `Method`, `Header` and `Query`, then apply middleware and forward to services. Default priority is rule-string length, with explicit priority overrides. [Rules and priority][traefik].                                                                                                                                                                 | Compile an explicit simulator order. Do not treat file order as Traefik's native default or run its rule DSL/middleware.                                                                                                                 |
| Azure APIM         | An API exposes operations with HTTP verbs and URL templates; the backend URL and policies determine forwarding. `set-backend-service` can select another backend. [Operations][apim-operations], [Backend policy][apim-backend].                                                                                                                                                                         | Operations become endpoints, with route-specific policies passed to P3. API/product/account quotas remain shared where configured.                                                                                                       |
| Azure Front Door   | Routes match protocol, frontend host and paths, using exact then wildcard path selection. No matching host/path is a 404. Associated rule sets process conditions/actions in order and may stop further evaluation; rules can override the origin group. [Route matching][frontdoor-routes], [Rule sets][frontdoor-rules], [Actions][frontdoor-actions].                                                 | Distinguish route selection from rule-set transformations. A flattened ordered simulator table needs an approximation note when several native actions would run.                                                                        |
| Cloudflare Workers | A route pattern selects a Worker in front of a proxied origin. Patterns use wildcards, with the most specific match winning; they are not regex and cannot contain query parameters. A more specific route without a Worker can bypass Workers. [Workers routes][cloudflare].                                                                                                                            | Host/path rules can illustrate Worker selection, while method/header logic belongs inside the Worker. Use an explicit default-to-origin to depict bypass; lack of a Worker match is not inherently a 404.                                |
| Apigee             | A `ProxyEndpoint` contains conditional `RouteRule`s selecting `TargetEndpoint`s or URLs. The first matching rule executes; an unconditional rule should come last. A null route can respond without a backend. [Routes][apigee].                                                                                                                                                                         | Same conditional-target/default abstraction; API policies and synthetic successful responses are outside R1.                                                                                                                             |

### Common denominator, with explicit limits

The useful intersection is **match → select target → apply policy → forward**, represented by an ordered list,
method/path/host/header predicates, one or more alternative targets, and a default. Exact, prefix and template
paths cover common service/API diagrams. Query equality is an advanced optional predicate for ALB-style cases.
Weights express canary splits such as 90% stable / 10% new. They are supported by several systems, not necessarily
as part of every vendor's native Route object.

For the simulator, **no matching rule and no default means rejected 404**. This is an intentional generic lesson,
not a universal vendor claim. ALB runs its configured default action; Cloudflare can bypass to origin; Fastly's
outcome depends on backend/program configuration. API Gateway REST documents 403 `MISSING_AUTHENTICATION_TOKEN`
for unsupported methods/resources, and 404 `RESOURCE_NOT_FOUND` in other cases. A later vendor adapter may attach
that status while preserving the shared rejection category. [API Gateway gateway responses][aws-responses].

### Which stencils get a route table?

Use a **profile capability for HTTP routing**, not `simRole === "gateway"` alone. Roles remain the engine's contract;
many gateways are DNS or packet devices that do not inspect HTTP paths.

| Existing stencil ids (catalog checked at this base)               | Proposed availability                                                                                                                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kong`, `azure.api-management`, `aws.api-gateway`                 | API gateways: optional route table, scoped limits and destination endpoint selection.                                                                                                         |
| `nginx`, `envoy`, `traefik`, `haproxy`, `istio`                   | HTTP proxies/ingress/mesh routing: optional route table, labelled as the shared model rather than full vendor config.                                                                         |
| `aws.elb`, `azure.app-gateway`, `load-balancer`                   | HTTP/application load balancing. `aws.elb` also represents NLB: hide HTTP routes when a future explicit L4 profile is chosen.                                                                 |
| `azure.front-door`, `cloudflare`, `generic.cdn`                   | CDN/edge routing to origins; enabling routing does not implement caching.                                                                                                                     |
| `generic.adc`, `f5.bigip`, `netscaler.adc`                        | ADC HTTP virtual-service/content switching. Retain throughput, HA and health checks; no iRules/policy execution.                                                                              |
| DNS/Route 53/Traffic Manager, routers, switches, NGFWs; `linkerd` | No HTTP route-table control by default. Packet routing and security deny rules remain separate. Linkerd's feature support is not established by this vendor survey; audit before enabling it. |

Also enable `gcp.cloud-load-balancing` for its HTTP/application profile: Google Cloud's URL maps select backend
services/buckets from host/path rules and a default. Keep L4 profiles excluded. [URL maps][gcp-url-maps].

**Kong exists** as `kong` / “Kong Gateway” in `src/stencils/catalog.ts`; `docs/ICONS.md` already attributes
`kong.svg` to `logos:kong-icon` from gilbarbara/logos (CC0 artwork). Reuse it, its profile and its education rather
than adding a duplicate. **Fastly does not exist** in that catalog. Recommend one Network stencil, proposed id
`fastly`, role `gateway`, with optional routes and backend terminology. VCL versus Compute is education/metadata
at first; do not invent a throughput, cache hit rate or Compute allocation preset.

Follow [ICONS.md](../ICONS.md): verify the exact asset and redistribution grant before adding artwork, record
source/version/license/attribution, and retain nominative trademark use without endorsement. Simple Icons lists
a Fastly slug and licenses its collection CC0, while warning that individual icons can have additional terms and
that trademark rights are separate. This is a **candidate**, not clearance of a downloaded Fastly mark. R3 can
reuse the existing `generic-cdn.svg` Lucide ISC glyph with the Fastly name if that asset audit is inconclusive.
[Simple Icons slug list][icon-slugs], [License][icon-license], [Legal disclaimer][icon-disclaimer].
No icon is added by this research.

## 2. Data model and compatibility

### Three meanings that must stay distinct

- **Request route:** an addressed traffic class, e.g. `POST /orders`, with stable diagram-scoped id. The address is
  carried by the message; its id joins traffic, colour, counters and explanations. It is separate from business
  message `type`, such as `OrderPlaced`, and from a gateway rule id.
- **Routing rule:** an ordered predicate and forwarding action at one router. It matches address attributes,
  never a route id exclusively, so different sources can reach the same rule.
- **Endpoint:** a handler inside the destination node, e.g. `POST /orders/{id}`. Its stable id is scoped to that
  node, as P6 proposed. It accepts matching addresses and supplies behaviour; it is not another canvas node.

P2's existing “routes” are consumer-group/subscription/binding connections. They retain `group`, their allocation,
and their broker meaning. UI and agent prose say **Request route**, **Route table**, or **Subscription/Binding**
where otherwise ambiguous; no renaming of stored P2 fields is necessary.

### Proposed TypeScript sketch

Names below are proposed additions, not edits to today's types. `ApiBehaviour`/`Quota` refer to the P3-compatible
contracts from [planning-model.md §4.3](planning-model.md#43-proposed-typescript-contracts); adopt the merged P3
names and ledger rather than create competing quota types. Omitted fields inherit the current resolver.

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
type PathMatch = { kind: "exact" | "prefix" | "template"; value: string };

interface RequestAddress {
  method: HttpMethod;
  path: string; // concrete pathname, e.g. /orders/42; query is separate
  host?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}
interface RequestRoute {
  id: string; // diagram-scoped, opaque, retained under rename/reorder
  label?: string;
  address: RequestAddress;
  appearance?: { paletteSlot: number; marker: "circle" | "square" | "diamond" | "triangle" };
}
interface RequestAttributes extends RequestAddress {
  routeId?: string; // known traffic class; matching still uses the address
}
interface RouteMatch {
  methods?: HttpMethod[]; // absent = any; alternatives OR together
  path?: PathMatch;
  hosts?: string[]; // exact hosts, OR together
  headers?: Record<string, string>; // exact values; all entries AND together
  query?: Record<string, string>; // advanced equality; all entries AND together
}
interface RouteTarget {
  edgeId: string; // outgoing ordinary flow of this router
  weight: number; // nonnegative integer; normalized among alternatives
  endpointId?: string; // optional handler on that edge's destination (R2)
}
interface RouteAction {
  targets: RouteTarget[]; // nonempty; at least one positive weight
  quotas?: Quota[]; // P3 admission, in addition to router/global/shared quotas
}
interface RouteRule extends RouteAction {
  id: string; // router-scoped stable id; ledger scope includes node id
  label?: string;
  match: RouteMatch;
}
interface RouteTable {
  rules: RouteRule[]; // first match in this order
  default?: RouteAction; // evaluated last; absence = rejected 404
}
type TrafficMix =
  | { mode: "shares"; entries: { routeId: string; share: number }[] }
  | { mode: "rates"; entries: { routeId: string; ratePerSec: number }[] };

interface RoutingNodeProps extends NodeSimProps {
  trafficMix?: TrafficMix; // source capability only
  routeTable?: RouteTable; // HTTP-routing profile only
  endpoints?: ApiEndpoint[]; // R2; P6 behaviour with template acceptance
}
interface RoutingEdgeProps extends EdgeSimProps {
  requestRouteId?: string; // explicit caller address for this Request branch
  endpointId?: string; // P6 reference on edge.to, Request only
  requestFilter?: RouteMatch; // optional attribute filter, notably broker bindings
}
// Extend the new recognised PlanningModel revision with requestRoutes?: RequestRoute[].
// Engine Message / InjectOptions / Particle / TraceStep gain optional request attributes.
// ApiEndpoint keeps P6 id/method/path/behaviour; its path may be an OpenAPI template.
```

`appearance` is optional authoring metadata. On first route creation allocate an unused colour/marker pair in
stable creation order and save it; absence derives a deterministic fallback from id. Two definitions with the
same address can represent deliberately distinct traffic classes; offer reuse by default. Concrete ids such as
`orders-post` in the example below are illustrative, not magic strings.

### Traffic mixes and calls

**Shares mode:** source `ratePerSec` (or its saved traffic profile) is the total; finite shares in [0,1] sum to 1
within a fixed validation epsilon, proposed 10^-9. The editor offers an explicit Normalize action rather than
silently adjusting a file. Each generated request chooses one class, rather than copying once for every mix row.
At 100 requests/s, shares 0.2 Orders and 0.8 Search mean 20/s and 80/s.

**Rates mode:** each row supplies a real requests/s rate and the sum is the source total. A stored `ratePerSec`
remains dormant and is restored when the mix is removed; it is not added to that sum. Show the computed total,
not two conflicting editable totals. Traffic × scales all rows once. Saved constant/ramp/spike profiles supply
a total envelope and scale the current mix proportions; a burst count is divided by the same proportions.
Reject a positive profile total with an all-zero rates mix, whose proportions are undefined. Zero rates with
no positive override emit nothing. Setup/timeline can atomically replace the mix; they do not deep-merge rows.
Absent mix keeps existing source behaviour. Manual injection uses the mix unless an explicit request is supplied;
an explicit injection count remains independent of Traffic ×, as today.

Example persisted props and planning extension, with only the relevant fields shown:

```json
{
  "planning": {
    "revision": "p3-routing",
    "requestRoutes": [
      { "id": "orders-post", "address": { "method": "POST", "path": "/orders" } },
      { "id": "search-get", "address": { "method": "GET", "path": "/search" } }
    ]
  },
  "sourceProps": {
    "ratePerSec": 100,
    "trafficMix": {
      "mode": "shares",
      "entries": [
        { "routeId": "orders-post", "share": 0.2 },
        { "routeId": "search-get", "share": 0.8 }
      ]
    }
  },
  "gatewayProps": {
    "routeTable": {
      "rules": [
        {
          "id": "orders",
          "match": { "methods": ["POST"], "path": { "kind": "exact", "value": "/orders" } },
          "targets": [
            { "edgeId": "gateway-orders", "weight": 90 },
            { "edgeId": "gateway-orders-canary", "weight": 10 }
          ]
        }
      ],
      "default": { "targets": [{ "edgeId": "gateway-search", "weight": 1 }] }
    }
  }
}
```

This is a fragment, **not a complete DiagramFile**: node props belong on their nodes, the referenced edges must
exist, and `p3-routing` is a working revision name. The default deliberately forwards all other requests to
Search; remove it to demonstrate a rejected 404 for an unknown address.

For direct calls from a source/processor, `edge.props.requestRouteId` explicitly sets the address on that outgoing Request copy. Two Calls
rows on a processor can call `POST /orders` and `GET /inventory` on the same or different nodes, each with existing
independent `share` if desired. That models multiple calls per handled input, not a normalized exclusive source
mix. A source mix sent to one gateway edge lets the gateway select the downstream service. A source directly
connected to several services can use `requestFilter` on those edges to deliver only matching classes. Overlapping
fan-out filters intentionally create copies, and the inspector explains this. A direct caller's explicit address
is resolved before its branch's `requestFilter`; other branches retain their own attributes. Without explicit
caller address, attributes pass through; `emits` only changes business message type. Gateway forwarding always
retains the incoming address: caller overrides on gateway edges are dormant, not implicit path rewrites.

### Endpoints and OpenAPI (P6/P7)

An outgoing route target may name an endpoint on its edge's destination, or inherit that edge's `endpointId`.
If both exist and differ, reject the configuration. No endpoint specified means the destination's ordinary
whole-node behaviour; adding endpoint records never redirects old whole-node calls. An explicitly targeted
endpoint verifies method/path and optional acceptance constraints before processing; mismatch is rejected 404,
not another endpoint picked by a similar name. Method/path edits preserve the endpoint id but may produce a
visible mismatch finding. Endpoint and route definitions are different records even when their display text agrees.

Endpoint paths may be templates; request paths are concrete. `GET /orders/42` can target `GET /orders/{id}`.
A template route imported from OpenAPI requires explicit sample parameter values before it generates traffic;
do not put literal `{id}` into a simulated concrete address or guess a real id. An endpoint-only caller can
derive an exact method/path address, but a template needs those samples. For a gateway that exposes `/api/orders`
while the upstream endpoint accepts `/orders`, keep the mismatch visible: general path stripping/rewrites are
deferred. A future explicit bounded rewrite can retain route identity and record before/after addresses.

[OpenAPI 3.1.1][openapi] supplies operation methods, path templates, operationId, parameters and server descriptions.
P7 imports selected operations as endpoint records on a selected/new API node. It can create optional request-route
samples and preview rules pointing to user-selected outgoing edges, ordering concrete paths before templates
where their matches overlap. It cannot infer which microservice owns an operation or a source's traffic shares,
latency, rate limit or failure probability. All assumptions come from the user or a documented
`x-livediagrams-sim` extension. A documented 429 is not a measured error percentage.

Retain P7's local worker, OpenAPI 3.0/3.1 JSON/YAML scope, 5 MiB input and 500 selected operations, text/depth/ref
budgets and local `$ref` cycle detection. No remote refs, server fetches, credentials or “Try it”. Reimport matches
unique operationId then method/path, preserves stable ids and explicit measurements, previews ambiguity/deletions,
and applies one undo step. Descriptions remain plain text; server URLs are metadata, not connect-src additions.

### File format, edits and agent contracts

All route fields are optional. **No routes means exactly today's playback**, including legacy/p1/p2 seeds, numeric
resolution, counters, colours, round-robin, broker grouping and `share`. The old planning research's additive-v1
suggestion was superseded by implemented `diagrams/v2`/recognised revisions. Keep v1/p1/p2 until explicit upgrade.
Use a new recognised revision composing merged P3 with routing (working `p3-routing`); if autoscaling is also
present, compose its supported semantics too. Do not put active routing fields under `p2`, which old readers
would ignore. Older readers must refuse the new revision, not preserve JSON while simulating the wrong model.

The upgrade preview lists changed behaviour and pins existing resolved defaults and saved setup/timeline values.
Adding the first table offers a default forwarding action matching today's outgoing pool before applying; removing
that default explicitly enables 404s. Once enabled, an empty table with no default rejects every addressed request.
Removing the whole `routeTable` restores round-robin. Removing routing and revision changes are undoable together.
Legacy export is named lossy, lists lost mixes/tables/endpoints/appearance/quotas and cannot promise equivalent
playback by retaining numeric defaults alone. Read-only and HTML readers must support the revision before release.

Proposed simulator bounds (not vendor limits): ≤500 request-route definitions per diagram, ≤64 mix rows/source,
≤256 rules/router, ≤16 targets/action, ≤500 endpoints/node; ids/text/paths ≤200 characters. Request/match headers
and queries each have ≤16 entries with names ≤64 and values ≤200 characters. Methods are the closed enum above;
weights are integers 0–10,000, with positive total. Mix total must respect `SIM_LIMITS.ratePerSec`; document-wide
source sampling/volume limits still apply. Bound total rules/targets/endpoints with the existing planning/import
budgets, not just per-node caps. Validation errors name the field and bound; never accept an unbounded extension
because node props permit additional keys. No arbitrary regex or script conditions in R1–R3.

Validate ids and references using compiled maps: route ids exist; targets are ordinary outgoing flows, never
dependencies, DLQ paths or annotations; endpoint belongs to `edge.to`. Support sync request forwarding and
explicit async transport of request attributes; endpoint targeting itself requires a Request edge. A routing
table on an incompatible profile is dormant and
explained when changing stencils, with Remove, rather than executed. Reject an attempted new incompatible table.
Missing imported references disable route-dependent simulation/planning with actionable diagnostics, never
silently bind to a label or turn it into an HTTP 404. Invalid configuration and unmatched valid traffic differ.

Copy/paste remaps node, edge and endpoint references; copied rules get scoped identities on the new router, and
request-route definitions are reused within a document or copied/remapped across documents. A deleted target/route/
endpoint previews affected bindings and requires an explicit replacement or removal within the same undo step.
Never widen a default or select another edge silently. Reconnecting preserves authored props but validates
destination endpoint ownership and route targets. A dry-run agent batch must report the same diagnostics.

Agents use existing `edit_diagram` `add_node`/`update` for `props.trafficMix` and `props.routeTable`, and `update`
on edges for `requestRouteId`, `endpointId`, `requestFilter`. Nested properties are atomic replacements; `null`
removes a whole property. Because request-route definitions are diagram-scoped, extend `set_meta` with an optional
complete `requestRoutes` replacement, validated against the final batch. No separate network provisioning tool.
Agents can `connect` with a key, then update its props and reference the resulting edge in a table; resolve these
batch keys to canonical edge ids before persistence. Never use ambiguous display labels inside stored tables.

Update model/sim types, shared `simProps` validation, native schemas/parser/serializer/storage, saved simulation
profiles/injections/setup/timeline, agent `index.ts`/schemas/ops/describe/validation, and all export/viewer readers
together. `describe_diagram` includes bounded definitions, table order, mixes, endpoint bindings, route counts,
rejection reasons and numerical explanations, marking omitted rows. Regenerate agents' schemas/reference/validator
with `pnpm schemas`, add schema/ops round-trip tests, and check viewer freshness on implementation. Run the required
`pnpm skill:release` and marketplace patch rule when the released viewer is stale. This document changes no schema,
catalogue or generated artifact.

## 3. Simulation semantics

### Matching and bounded cost

Compile once on load or an authored configuration revision: index ids/edges/endpoints, normalize method and
host/header names, tokenize templates, and resolve target weights and edge policies. Recompile only affected
tables on edits, never on a tick/frame or for each message. Store an immutable configuration generation in checkpoints.

Rules are checked in authored order; the first matching rule wins. Across fields use AND; methods/hosts within
a field use OR; header/query entries use AND. Absent predicate means unconstrained; disallow empty alternatives
and an entirely empty rule match (use Default). Paths are case-sensitive: exact equality; prefix is literal
`startsWith` (`/api` also matches `/apian`); template parameters match one nonempty path segment, literals exactly,
without regex/backtracking. Use `/api/` or a template to require a segment boundary. Query is excluded from pathname;
host comparisons are case-insensitive, without scheme/port; headers use case-insensitive names and case-sensitive
values. Reject duplicate case-folded header names, control characters and malformed paths; preserve percent-encoded
pathname text without repeated decoding or implicit slash/dot normalization. Missing host/header/query fails a
predicate that requires it. This is a documented modelling grammar, not every vendor's URL normalization.

For R rules, T targets in the selected action and bounded fields/length L, compilation is O(total configuration
bytes + edges); matching is O(R × L). Scan at most T targets to filter them and form eligible cumulative weights,
then select with one seeded draw: O(T × L), including edge filters. Do not binary-search a precomputed distribution
that still includes targets rejected by this request's filters. M decisions cost O(M × (R + T) × L), **not**
O(M + R) when both grow. Do not claim constant-time arbitrary routing or linear growth when scaling both axes.
At the ≤256-rule bound, a simple ordered scan is reviewable; add a cache/index only if profiling justifies it,
with a bounded key count and order-preserving behaviour. Frame work stays at the existing particle cap; rendered
legend and route metrics are bounded independently of generated messages.

### Selection, edge policy and admission order

1. Sources create one route class per mix item emission. Node `emits` continues to rename type before edge filters;
   `edge.emits` continues after selection. Neither changes request attributes or its route colour.
2. A router with a table matches address attributes first, independent of outgoing edge order. If a rule matches,
   it is final: filtering/unavailability never causes a later rule or Default to catch the same request. Default
   is used only if no rule matches. A sync arrival without an address can use Default only; without Default it
   rejects 404. An unaddressed async business event uses legacy routing, so the table does not invent HTTP metadata.
3. Consider only the selected action's positive-weight targets passing existing type `filter` and optional
   `requestFilter`. Type wildcards retain exact/trailing-`*` semantics (`Order*`, `*`), not HTTP path syntax.
   Filters never widen a target set or send an Orders request through an unrelated Search rule. Existing `share`
   is ignored for gateway table selection, as for gateway round-robin; show it as dormant there.
4. Select exactly one eligible edge by normalized weights. Use a dedicated deterministic stream derived from
   run seed + router id + rule id, including Default's reserved identity. Checkpoint its PRNG state; rendering,
   tracing and colour assignment consume no randomness. Weight zero never selects; multiplying all weights
   by the same factor preserves distribution. Splits are probabilistic expectations, not exact small-run quotas.
5. A selected deny edge blocks at the sender under today's policy: count `blocked`, not dropped/rejected, and
   do not debit forwarding admission buckets. Otherwise resolve explicit endpoint acceptance and all applicable
   **router + matched-rule/default + shared** quota
   scopes before committing admission. Reuse P3's atomic admission transaction and simulation clock. A 404 or
   incompatible target does not partially debit a bucket. Only admitted work enters the router's delay/throughput
   path and forwards; destination admission separately charges its own node/endpoint/shared quotas on arrival.
   Gateway and service quotas are distinct scopes, not two declarations charging one bucket twice per attempt.
6. Endpoint validation occurs before destination execution, and P3 decides target concurrency/quota rejection.
   A selected down target uses existing outage semantics; it is not an unmatched route or a 404. Do not introduce
   new retry/caller waits.

To keep scope clear, R1 **does not redistribute a configured weighted split when a selected backend is unhealthy**.
It keeps the configured allocation, so a 10% canary outage stays visible; disabled/down delivery follows the
existing execution policy. Legacy gateways without tables keep their existing health-check round-robin behaviour.
This matches ALB's lack of automatic weighted-group failover, but is an approximation for other routers. The
inspector explains that existing health checks do not redistribute table weights; a later explicit failover
policy would need a separate reviewed contract. Network throughput/HA constraints still apply to admitted work.

If no rule/default exists, or the selected action has no filter-compatible target, record **rejected 404** with
distinct reasons `route-not-found` / `route-no-eligible-target`. This latter code is our simulator policy for
incompatible explicit routing, not a claim about an ALB/Envoy production response. Never call either dropped,
failed or blocked. Increment P3 `rejected` once in represented real units, plus a bounded reason/route breakdown;
`throttled` remains the 429 subset, not every rejection. End the branch, release its work/lineage ownership once,
and return a visual rejected reply only where today's request edge supports replies. Trace the rejecting node,
address, matched rule if any, code and reason. The whole chain does not begin waiting for that reply.

Per-rule quotas can illustrate Kong's rate-limiting plugin: two public routes to one service have separate rule
buckets plus a shared gateway/account cap. They are not per-dot limits: P3 charges the real units represented by
each sampled message. Use its algorithms/windows, checkpoint state and retry ownership, not an invented default
token bucket labelled exact Kong behaviour. Unspecified quotas stay unknown; no numeric vendor cap is inferred.

### Brokers, sampling, checkpoints and analysis

Request attributes travel through a broker as immutable envelope attributes, including on copies, redelivery and
DLQ paths. A `requestFilter` on a subscription/binding can match method/path/host/header, alongside business type
`filter`. It models a topic routing key/header binding without conflating `POST /orders` with `OrderPlaced`.
HTTP path routing does not simulate Kafka partition keys, ordering or a full RabbitMQ wildcard exchange DSL.

Retain P2 groups: each subscription/binding gets one copy when compatible; edges sharing a name compete; logs
assign reader instances per partition/shard; non-partitioned subscriptions use the shared fleet. Retries restore
the original broker type as today and also retain the original request attributes, even if the consumer created
new downstream requests. A route-filtered-out group gets no pending message/lag for that class. A compatible
group without a ready reader keeps work under existing rules. No route creates another replica or slot pool.

Mix generation uses per-route fractional credits in simulation time (or a bounded weighted-deficit schedule for
a fixed total profile); zero shares/rates never emit. Carry remainder across ticks, including rare classes under
sampling, and order equal-time emissions by stable source/route identity. Divide real rates by scale exactly once.
One dot carries one address and represents scale homogeneous requests; it cannot contain 20% Orders and 80% Search.
Bound count error per class by the scheduler's fractional credit, and label coarse sampling uncertainty. Route
proportions do not multiply global particle/source/volume budgets or require one always-visible dot per row.

Checkpoint/reset/restart/seek must include mix credits, selection streams, route metrics, resolved endpoint ids,
P3 admission ledgers and lineage attributes. Slow-motion look-ahead restores all of them; the same seed/document/
actions reproduce the same routes after restore, independently of particle cap, tracing or render cadence.

Extend the shared pure capacity analysis and explanations to traffic classes `(message type, request route)`.
Use the same compiled matches/filters/endpoint resolution as playback; propagate source rates, independent caller
copies and normalized table weights. Preserve current bounded fixed-point iteration/nonconvergence checks.
Report **offered**, **admitted**, **rejected** and **completed** per route separately: quotas can protect a backend
without hiding user demand. Configured split predictions and observed seeded counts have different labels.

Endpoint-specific latency changes the workload share of the parent's pool. With arrival rates λr and mean
durations sr seconds, slot work is Σ(λr × sr), compared with the node's shared replica/concurrency slots. Endpoint
limits and parent/shared quotas intersect, rather than every endpoint owning the parent's full capacity. Compose
with autoscaling's ready fleet/resource costs and P2 assignments without adding another controller; unknown endpoint
duration is inherited or reported unknown. Gateway matching does not replace HA/throughput or P3 admission.

Example: **“POST /orders is 20% of traffic: 20 req/s. Orders handles about 16 req/s (1 replica × 4 slots / 0.25 s).
Waiting work grows by about 4 req/s.”** At a declared 50% utilisation target, `ceil(20 / (16 × 0.5)) = 3` replicas
would suffice if no quota/partition/resource constraint binds. A shared Search endpoint using those same slots
changes the calculation. If a gateway admits only 12/s, show the 8/s rejected and 12/s reaching Orders; do not
claim scaling Orders will fix the route quota. Keep the existing explanation/urgent trouble surfaces and one
appropriate Apply fix; a hot route offers processing, mix or quota changes with evidence, never invented replicas
for an external API.

## 4. UX review: simple by default

Routing is off until added. The default node, connection, inspector and Live canvas keep their current controls;
there is no Routes top-bar button, new toolbar or setup wizard. Compatible routers offer **Add routes…** through
Properties/context actions. Sources offer **Add traffic mix…**; API/service nodes offer collapsed **Endpoints**
in R2. Follow the action registry, undo transactions, keyboard/focus rules and [UX-PRINCIPLES.md](../UX-PRINCIPLES.md).

The selected router's inspector contains a small **Route table**, with **at most four visible columns**:

| Order | Match        | Send to               | Split   |
| ----- | ------------ | --------------------- | ------- |
| 1     | POST /orders | Orders; Orders canary | 90 / 10 |
| 2     | GET /search  | Search                | 100%    |
| Last  | Default      | Reject 404            | —       |

The compact Match summary opens row details for method, exact/prefix/template, host and Advanced header/query
conditions. Send to picks existing outgoing connections and optionally endpoints; explain missing connections
with one Add connection action. Split opens target weights rather than adding a column per destination. Reorder
has drag and keyboard Move up/down actions, announced position, and a warning for shadowed rules. Default is a
fixed last row, with Reject 404 or destinations. First activation previews a forwarding default so the user can
preserve today's path; reject is an explicit choice. Each row edit/reorder/delete is undoable; destructive removal
shows affected bindings and offers repair. Virtualize/page long tables rather than widening the inspector.

The source **Traffic mix** has three columns: Route (with swatch/marker), Share or Rate, and a row action menu.
One mode choice lives in this section, and a total readout teaches the distinction. “Add route” is its primary
action; a shared definition editor supplies method/path and collapsed host/header/query detail. A processor's
existing Calls rows expose an optional request route and endpoint; processing capacity stays shared.

An addressed edge keeps its authored business label and shows a secondary `POST /orders` or targeted endpoint
label, with complete text on hover/focus. Several rules on one edge show “3 routes”; the inspector lists them.
Weighted alternatives show a secondary split hint when inspected. Reuse existing overlap-aware label placement;
never put an endpoint card or a pill for each route on every node.

### Particle colour, accessibility and trace

Use a route-specific **Okabe–Ito** colour-universal palette as the starting set: orange `#E69F00`, sky blue
`#56B4E9`, bluish green `#009E73`, yellow `#F0E442`, blue `#0072B2`, vermilion `#D55E00`, reddish purple `#CC79A7`.
Pair it with circle/square/diamond/triangle silhouettes; theme-specific contrasting outlines keep particles and
swatches visible, especially yellow on light canvas. Evaluate the actual small-dot rendering in both themes and
colour-vision simulations; the palette's reputation is not sufficient validation. W3C requires a visible cue
beyond colour. [Colour Universal Design][colour], [WCAG Use of Color][wcag-colour].

Allocate and persist a colour/marker pair per stable request-route id. Reordering/renaming rules or endpoints,
changing weights, copying within a diagram, `emits`, replay, reload and export preserve it. Unaddressed messages
keep today's type colours; a new explicitly addressed downstream call gets its own route pair while trace root
identity still connects the journey. More routes reuse colours with distinct markers and a textual route key;
after all pairs repeat, do not claim dots are individually identifiable: selection/trace/legend identifies the
address. No ever-growing palette or bespoke colour for each concrete parameter value.

Only when addressed traffic exists, a compact **Routes legend** appears in the existing Live inspector/trace area,
not a floating canvas overlay. It lists swatch + marker + method/path + configured share/observed count, with at
most seven visible entries and an expandable searchable remainder. In presentation/recording/HTML it uses the
existing information area and reserved space; selected entries remain readable at a distance. Keyboard focus
and screen readers announce the route text and count; clicking a legend row highlights that class without changing
traffic. A textual “20 req/s” is labelled real units, not estimated from visible dot count.

Outcome styling stays separate from route identity: a rejected reply has an error ring/cross and `404`/`429`, a
retry has the existing retry cue, and a DLQ trip has the dead-letter cue. Retain the route swatch/marker in the
trace and legend even when the particle uses an outcome tint; never replace all route identity with red. Reduced
motion uses still markers and textual steps. These style changes must work in the main renderer, worker/canvas
renderer, slow motion, recording and HTML viewer, not only DOM particles.

Slow motion adds a routing beat: **“POST /orders → rule 1 → Orders canary (10% split)”**, or **“GET /unknown → no
match → rejected 404.”** Trace steps record address/route id, router-scoped rule id, selected edge/endpoint, weight
and rejection reason; summaries/cards/Sequence diagram show concise method/path with full detail on focus.
Look-ahead uses the existing checkpoint and pause machinery, so colours and targets remain exactly those seen
when Live resumes. The bounded history does not retain unbounded request payloads or header text in every frame.

Until routes exist, hide the table, mix rows, route legend, route colour settings, per-route metrics and endpoint
target fields; leave only contextual Add actions where supported. After activation keep host/header/query,
quotas and appearance under row details/Advanced. New UI strings use `t()`/`src/i18n/en.ts` and `pnpm i18n check`;
vendor names and user-authored routes are not translated. Every interactive control gets `data-testid`.

Design review against the chrome budget: no additional top-bar control, no endpoint nodes, four router columns,
three mix columns, no always-open advanced fields and no overlapping canvas legend. Each implementation PR ends
with the repository's designer UX gate, recording findings in `docs/DESIGN-REVIEW.md`, before the next feature batch.

## 5. Phasing and acceptance

Propose **P6: endpoints and routing** as three reviewable PRs. R1 depends on merged P3 and the existing P1/P2
contracts; do not implement a provisional second admission engine. R2 completes the endpoint behaviour from P6.
R3 includes P7's import overlap. This is a design proposal for review, not authorization to ship app code in this
docs branch. Run the project's normal gates per implementation PR, including schema/viewer compatibility and
production-build Playwright with explicit allowed ports and `data-testid` selectors only.

### R1 — Request model, mixes, gateway tables and colours

Ship bounded optional request-route records/attributes, traffic mixes, direct caller addresses, table matching,
weights/default, P3 rejected 404s and rule quotas, attribute filters for broker composition, route counters and
accessible particles/legend/trace. Include configured route-demand propagation so the existing planner does not
contradict playback. Do not expose unfinished endpoint-capacity controls.

Acceptance fixtures belong in the Lab (`src/lab/presets.tsx`), using constructed public systems:

- **Mix:** 100/s with Orders 20% and Search 80% preserves the total and the requested counts within one scheduler
  dot per row over a simulated horizon; rates 2/s + 8/s give 10/s, not stored node rate plus 10. Test zero/rare rows,
  sampling and multiplier/profile envelopes. Same seed/actions and checkpoint restore reproduce emissions.
- **Order and matching:** overlapping broad prefix and exact rule prove first match wins; swapping rules changes
  the destination. Cover method/host/header/query, missing fields, case, prefix boundary and templates. A matching
  rule with incompatible edge filters never falls through to Default or a later rule.
- **Weights:** fixed seeded sequence is reproduced; scaling 9:1 to 90:10 preserves selection, zero never wins,
  and a bounded large sample meets a declared count tolerance (e.g. five binomial standard deviations). Selection
  never creates two copies. A down 10% canary does not silently become a 100% stable split.
- **Default/404:** unmatched address reaches the configured default; without it, P3 `rejected` rises once with
  404 and `route-not-found`, while `dropped`, `failed`, `blocked` and `throttled` do not. Filter-exhausted action
  has its separate reason. Releasing work makes in-system/lineage counts finish; a bad config reference is refused.
- **Composition:** trailing `*` type filters and node/edge `emits` retain their order; route metadata and colour
  survive renaming, broker fan-out/retry/DLQ. Two compatible P2 subscriptions receive copies, two edges sharing
  a name compete for one; route-filtered-out classes add no lag. A partitioned log still caps instance assignment.
- **Admission:** global + rule + shared P3 quotas charge atomically; rejection 404 debits none, 429 does not look
  like lost traffic. Two routes cannot double a shared account quota. Sampled dots charge represented real units.
- **Identity/compatibility:** route colours/markers survive reorder, rename, save/open, recording/HTML and
  slow-motion restore. Unrouted v1/p1/p2 fixtures are identical before/after, seed for seed, including `share`,
  filtering, colours and round-robin; the new revision with no route settings also preserves the P3 baseline.
- **Bounds/growth:** count one table compilation per configuration generation and ≤R predicate evaluations per
  message; an idle frame compiles nothing. `growth()` compares R versus R/8 at fixed M, and M versus M/8 at fixed
  R, both below `LINEAR_LIMIT = 24`. Parse/compile outside the matching measurement. Separately measure compilation
  at 8× config size with the same bound. Remove the precompiled index/add a nested scan to prove regression detection;
  do not scale M and R together and call quadratic work linear. No absolute millisecond assertion or timeout waits.
- **UX/accessibility:** browser tests add a mix/table, reorder by keyboard, edit weights/default, trace a reject,
  use the legend without colour, Undo/Redo and inspect both themes/reduced motion. No new global chrome or label
  overlap; route selection agrees across live/slow-motion/export renderers.

For every implementation fix, temporarily remove/revert that fix and confirm its regression test fails before
restoring it. Prove the new feature tests too by disabling matching, selection, rejection counting or appearance
identity separately; a written acceptance list is not a test run.

### R2 — Service/API endpoints, shared capacity and explanations

Add optional endpoint records/editor, explicit targets on calls/rule actions, template acceptance, inherited
behaviour with P3 node+endpoint+shared quotas, and per-route workload/capacity explanations. Preserve whole-node
calls when adding endpoints; implement references/repair/Undo/schema/agent/export together.

- One service calls two routes on another service with distinct rates; the intended endpoint handles each.
  `GET /orders/42` targets `GET /orders/{id}`; wrong method/path is rejected 404. Unaddressed whole-node calls
  still use the parent, even after endpoints exist.
- Two routes with different durations exhaust the **same** node slot/resource pool; endpoint caps and parent/shared
  quotas all bind. At 20/s and 0.25 s, four slots cannot keep up; the explanation calculates 4/s growth and the
  declared-target sizing above. Add a second workload and verify no duplicate pool appears.
- Rename keeps stable references; a changed address produces a mismatch finding. Delete/reconnect/copy/import
  repairs or rejects bindings, Undo restores them, and native/agent/HTML readers retain the same semantics.
- A gateway route to an external API cannot gain capacity by drawing another copy of the API or adding service
  replicas. If autoscaling is supported, only its ready fleet contributes; P2 assignments and P3 quotas still bind.
- Browser tests confirm endpoint selection stays in the inspector, ordinary calls do not need configuration,
  labels avoid nodes/badges, and the existing explanation has one appropriate fix. Disable endpoint lookup/shared
  pooling to prove the unit regressions fail.

### R3 — Fastly stencil, Kong education and local OpenAPI import (P7 overlap)

Add the missing Fastly stencil after the icon audit, with generic glyph fallback. Keep the existing Kong stencil,
adding route/plugin education and discoverability only where necessary. Implement the selected-operation import
and optional gateway-rule/sample-route preview from §2, not a vendor config interpreter.

- Search finds Kong and Fastly exactly once; profile capability exposes optional routing while an untouched new
  node retains default simulation behaviour. Icon attribution passes review; no unaudited logo enters the bundle.
- A bounded OpenAPI 3.0/3.1 JSON/YAML fixture imports operations as endpoints inside one node. With explicit sample
  parameters and target mappings, previewed routes hit the right endpoint. No endpoint-per-canvas-node explosion,
  guessed microservice, traffic shares or fabricated limits/latency.
- Reimport preserves ids/appearance/user measurements; ambiguous duplicate operationIds, changed templates and
  deletes need review. Undo restores definitions, table order and references together; agents/schema round-trip.
- Local references work with cycle detection; external refs and oversize/deep specs produce actionable errors.
  The importer performs no network requests. Import setup/index growth stays linear by operation counts and
  same-run 8× ratios below 24; deliberately remove the bound/index to prove guards fail.
- Production-build tests cover CSP, import accessibility, lazy loading and `src/lib/bundleSplit.build.test.ts`/
  entry-size budgets; routing/import code and education stay outside startup chunks. Viewer freshness is checked
  and released under the project's marketplace-version rule before implementation ships.

## 6. Decisions rejected or deferred

- **Required routes/endpoints on every connection:** rejected; today's quick diagram must still work unchanged.
- **Use message `type` or edge `share` as the route model:** rejected; type renaming and broker events differ
  from an HTTP address, and independent copies are not an exclusive weighted split.
- **Pretend all vendors use first file-order match or unmatched 404:** rejected; the shared model is explicit,
  with native precedence/outcome differences documented and later adapters required for faithful imports.
- **Full VCL/Compute/iRules/NGINX regex, transformations, auth and sticky sessions:** deferred; bounded data rules
  teach this request flow without running scripts, exposing credentials or creating ReDoS/CSP risks.
- **Silently reroute to healthy services or fall through after a failed rule:** rejected; hides canary failures
  and can send a request to the wrong service. Future explicit failover policy needs its own contract.
- **Separate capacity per endpoint, quota per visible dot, or another P3 ledger:** rejected; invents capacity and
  miscounts real traffic. Shared pools and atomic scoped admission remain authoritative.
- **Colours alone, unbounded legend, endpoint canvas nodes or a global Routes mode:** rejected; inaccessible or
  consumes chrome. Saved colour/marker identity, contextual tables and the existing trace carry the detail.
- **Caller waits/deadlines/retry storms, full cache/CDN execution, Kafka keys and vendor config import:** deferred
  to their approved batches. This routing design does not silently implement sim-flows item 10 or broker ordering.

Remaining implementation decisions are the merged P3 contract/revision composition, exact fractional scheduler
error bound under coarse sampling, and small-particle palette contrast across renderers. R1 must resolve and test
these before release; none requires new global controls or external infrastructure.

## Sources and verification notes

Primary vendor documentation was checked on 2026-10-14. Fastly's direct documentation pages returned fetch errors
in the research browser; their indexed official documentation supplied the backend/VCL/Compute excerpts above.
No numerical Fastly defaults or unverified precedence tie-breaks are adopted. Documentation-only review does not
claim vendor account tests, benchmark results or implementation acceptance tests. All simulator caps, scheduling,
first-match rules and generic status choices are proposals, distinct from cited vendor facts.

[kong-services]: https://developer.konghq.com/gateway/entities/service/
[kong-routes]: https://developer.konghq.com/gateway/entities/route/
[kong-limits]: https://developer.konghq.com/plugins/rate-limiting/
[fastly-backends]: https://www.fastly.com/documentation/reference/api/services/backend/
[fastly-vcl]: https://www.fastly.com/documentation/reference/vcl/types/backend/
[fastly-compute]: https://www.fastly.com/documentation/guides/compute/developer-guides/javascript/
[fastly-balancing]: https://www.fastly.com/documentation/guides/concepts/load-balancing/
[aws-methods]: https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-method-settings-method-request.html
[aws-stages]: https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-call-api.html
[aws-responses]: https://docs.aws.amazon.com/apigateway/latest/developerguide/supported-gateway-response-types.html
[alb-rules]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-rules.html
[alb-actions]: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/rule-action-types.html
[nginx-locations]: https://nginx.org/en/docs/http/ngx_http_core_module.html#location
[nginx-proxy]: https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass
[envoy-matching]: https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_conn_man/route_matching
[envoy-routes]: https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/route/v3/route_components.proto
[istio]: https://istio.io/latest/docs/reference/config/networking/virtual-service/
[traefik]: https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/rules-and-priority/
[apim-operations]: https://learn.microsoft.com/en-us/azure/api-management/add-api-manually
[apim-backend]: https://learn.microsoft.com/en-us/azure/api-management/set-backend-service-policy
[frontdoor-routes]: https://learn.microsoft.com/en-us/azure/frontdoor/front-door-route-matching
[frontdoor-rules]: https://learn.microsoft.com/en-us/azure/frontdoor/front-door-rules-engine
[frontdoor-actions]: https://learn.microsoft.com/en-us/azure/frontdoor/front-door-rules-engine-actions
[cloudflare]: https://developers.cloudflare.com/workers/configuration/routing/routes/
[apigee]: https://docs.cloud.google.com/apigee/docs/api-platform/fundamentals/understanding-routes
[gcp-url-maps]: https://docs.cloud.google.com/load-balancing/docs/url-map-concepts
[openapi]: https://spec.openapis.org/oas/v3.1.1.html
[icon-slugs]: https://github.com/simple-icons/simple-icons/blob/develop/slugs.md
[icon-license]: https://raw.githubusercontent.com/simple-icons/simple-icons/develop/LICENSE.md
[icon-disclaimer]: https://raw.githubusercontent.com/simple-icons/simple-icons/develop/DISCLAIMER.md
[colour]: https://jfly.uni-koeln.de/color/
[wcag-colour]: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
