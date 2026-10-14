# Architecture checks: warnings with one-click fixes

Research and plan, October 2026. Batches 1 to 5 are built: the engine, four rules and `check_diagram`, then the
count, the Checks card, markers, the inspector row, fixes, Ignore and Turn off, then the other four starter rules,
then `secret-identity` and `schema-registry`, then **Run simulations**. Batch 1's precision gate, judged finding by
finding on the examples, is in "Batch 1: precision gate" below; batch 2's notes are in "Batch 2: as built"; batch 3's
and batch 4's gates and notes are in "Batch 3: precision gate", "Batch 3: as built", "Batch 4: precision gate" and
"Batch 4: as built"; batch 5's, with its table, in "Batch 5: as built".

## Summary

Live Diagrams already knows what each node does (its stencil's simulation role), what each edge means (a flow
or one of six dependencies), which boundary a node belongs to, and how much traffic each node can take
(`analyzeCapacity`). That's enough to answer "what's wrong with this design?" the way a reviewer would: a queue
whose failed messages vanish, a topic nobody reads, requests that go round in a circle, a service reaching into
another team's database, a public entry point with nothing in front of it, a consumer that can't keep up.

**Recommendation.** Add **checks**: a small, fixed rule set that runs locally on the diagram model and offers a
one-click **fix** for each finding, applied as one undo step through the same operations the agents use
(`applyOps`). Start with 8 rules. Two severities, **Warning** and **Suggestion**, and no errors: a diagram never
"fails". It's quiet by default. A muted "2 warnings" link appears under the diagram's title only when there's a
warning, and suggestions never show until you ask. Everything else lives in one **Checks** card that opens on
demand (**Check diagram**: the count, the canvas right-click, Ctrl+K). Markers on the canvas show only while the
card is open. A selected node with a finding shows it in its inspector, with the fix. Agents get one read-only
WebMCP tool, `check_diagram`. Its findings carry their fix as `edit_diagram` operations, so applying a fix is an
ordinary agent turn with Undo.

The rule set is tuned against the 16 public examples (a throwaway prototype, see "Evidence"). Rule shapes that
fired on almost every diagram were cut back until each remaining rule fires rarely and, when it does, points at
something an owner would plausibly change. Google's static-analysis teams require under 10% "effective false
positives" before a check ships ([SWE at Google, ch. 20][swe-20]). We hold every rule to that bar and turn off any
rule that misses it.

Checks use simulation results in one place only: **Can't keep up** reads `analyzeCapacity` at the diagram's own
rates. It doesn't play the simulation: checks stay instant and deterministic. Replaying saved simulations for
evidence ("312 messages were dropped here in _Payments goes down_") is on demand: batch 5's **Run simulations**.

## How others do it

| Tool                                   | What it checks                                                                                                                                        | Severity                                                                                     | Presentation                                                                                                                               | Fixes                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Structurizr** inspections            | Completeness: missing descriptions and technologies, disconnected elements, elements in no view, empty views, missing docs and ADRs ([docs][sz-insp]) | `error`/`warning`/`info`/`ignore`. **Every inspection defaults to `error`**                  | An Inspections page; CLI `inspect` returns the count. Overrides are properties on the workspace or any element, with wildcards (`model.*`) | None                                                                                                                          |
| **IcePanel**                           | No architecture rules. A **Health check** of action items (inaccurate comments, open questions) and an inaccuracy count per diagram ([docs][ip-acc])  | None                                                                                         | A count in the header; an inbox-style list                                                                                                 | None                                                                                                                          |
| **AWS Well-Architected Tool**          | Questionnaire per pillar ([glossary][aws-wa])                                                                                                         | High / medium risk issue. AWS says the risk "might be lower than indicated" for good reasons | Risk counts per pillar; an improvement plan                                                                                                | Guidance only                                                                                                                 |
| **AWS Trusted Advisor**                | Live account checks: cost, security, fault tolerance, limits ([docs][aws-ta])                                                                         | Red "Action recommended", yellow "Investigation recommended", green, grey "Excluded"         | Per check: Alert criteria, **Recommended action**, resources, **Exclude & refresh**                                                        | Guidance                                                                                                                      |
| **Azure Advisor**                      | Reliability, security, performance, cost, operational excellence ([docs][az-adv])                                                                     | Impact High / Medium / Low                                                                   | Postpone, Dismiss, Mark completed                                                                                                          | **Quick Fix** on some recommendations: tick resources, one click, trade-offs shown ([docs][az-qf])                            |
| **Google Cloud Recommender**           | Cost, performance, security ([docs][gcp-rec])                                                                                                         | P1 to P4 (default P4)                                                                        | "Save cost by changing machine type from n1-standard-4 to custom-2-5120": the benefit, then the action                                     | Some apply in place                                                                                                           |
| **Cloudcraft** (Datadog)               | Security and cost overlays on a live AWS/Azure diagram ([docs][cc-sec])                                                                               | Critical / High / Medium                                                                     | An **overlay** you turn on; legend filters; click a resource for a side panel                                                              | Links out to investigate                                                                                                      |
| **Camunda Modeler** (BPMN, in browser) | Lint rules on the model ([docs][camunda])                                                                                                             | Error / warning                                                                              | A collapsible **Problems** panel; a row selects the element                                                                                | No                                                                                                                            |
| **Sparx EA**                           | Well-formedness rules, toggled in "Configure validation rules" ([docs][sparx])                                                                        | Codes like `MVR01…`                                                                          | Output window; double-click selects the element                                                                                            | No                                                                                                                            |
| **Capella**                            | "Validate diagram"                                                                                                                                    | Error / warning                                                                              | Icons on elements. Users complained they stick around after a restart: noise ([forum][capella])                                            | No                                                                                                                            |
| draw.io, Lucid, Miro, Eraser, Ilograph | **No architecture validation.** Lucid support suggests faking BPMN checks with conditional formatting ([community][lucid])                            | —                                                                                            | —                                                                                                                                          | —                                                                                                                             |
| **ESLint**                             | Code rules with ids and doc URLs ([docs][eslint-rules])                                                                                               | `off` / `warn` / `error`                                                                     | Inline in the editor plus a Problems list; disable comments take a reason (`-- reason`), and unused ones are reported                      | `fixable` (safe, applied by `--fix`) vs **suggestions** (may change behaviour; a person applies them) ([docs][eslint-custom]) |
| **Polaris**, **kube-linter**           | `deploymentMissingReplicas`, missing probes, missing PodDisruptionBudget ([Polaris][polaris]); `minimum-three-replicas` ([kube-linter][kubelinter])   | `danger` / `warning` / `ignore`                                                              | Each check has a **remediation** text                                                                                                      | No                                                                                                                            |
| **Spectral** (AsyncAPI, OpenAPI)       | Rulesets over the spec ([docs][spectral])                                                                                                             | `error` / `warn` / `info` / `hint` ("discuss during design review")                          | `documentationUrl` per rule                                                                                                                | No                                                                                                                            |
| **tflint**, **Checkov**, **hadolint**  | IaC and Dockerfile rules                                                                                                                              | tflint `error`/`warning`/`notice`; Checkov LOW/MEDIUM/HIGH                                   | Ignore annotations with a reason: `# tflint-ignore: rule # reason`, `checkov:skip=ID:reason`                                               | No                                                                                                                            |

**What to take from them**

1. **Nobody does design-level checks on an event-driven diagram.** Structurizr checks completeness, cloud
   advisors check deployed resources, IaC linters check config. "This topic has no reader" or "these requests go
   round in a circle" only works because our model knows roles, flows and capacity. It's an open niche.
2. **Defaults decide whether people listen.** Structurizr's "everything is an error" and Capella's sticky icons
   are the counter-examples. Google: "developers ignore compiler warnings". A check that most people ignore costs
   attention and earns nothing, and Google turns such analyzers off ([SWE at Google][swe-20]). Developers in
   Johnson et al. named false positives and the way warnings are presented as the main barriers
   ([ICSE 2013][johnson]).
3. **The fix is the feature.** Azure's Quick Fix and ESLint's fixes are what people use. Google: "Anything that can
   be fixed automatically should be fixed automatically" ([SWE at Google][swe-20]). ESLint separates safe fixes
   from **suggestions** that change behaviour. Every fix here changes the design, so every fix waits for a click,
   as a suggestion does.
4. **Phrase the benefit, then the action** (Recommender, Trusted Advisor), and name the things involved.
5. **Ignoring needs a home.** Trusted Advisor's Exclude, Advisor's Dismiss, `tflint-ignore # reason`. Ours lives in
   the file, so a team shares it.

## Design

### Principles

- **Quiet until asked.** No new top-bar control and no toast. Suggestions never show uninvited.
- **Few, sharp rules.** Each rule is tuned until it rarely fires on a good diagram (see "Evidence").
- **Every finding names its nodes and offers a fix** where a sensible one exists. A fix is one undo step and says
  what it did ("Added orders.created.v1.dlq", with Undo).
- **Deterministic and local.** Checks read the diagram only: no network, no randomness. Private diagrams are
  checked like any other; only the agent tool follows the AI rules.
- **The simulation's model is the source of truth.** Checks reuse `compileTopology` (what counts as a consumer, a
  consumer group, a dead-letter route), `stencilRole`, `relationOf` and `analyzeCapacity`, so a check and the live
  view never disagree.

### Severity

| Level          | Meaning                                                                   | Shown                                                                                    |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Warning**    | Likely a real problem: messages lost, a backlog that only grows, overload | Counted under the title; listed first; amber triangle marker while the card is open      |
| **Suggestion** | Worth a look; often fine on purpose, or the diagram's level of detail     | Only in the Checks card and the node's inspector; blue dot marker while the card is open |
| **Off**        | The rule is turned off for this diagram (**Turn off this check**)         | Nowhere; "1 check off" at the card's foot turns it back on                               |

No "error": nothing here blocks saving, sharing or going live, and Google keeps hard errors for checks with no
false positives at all. A rule can raise its own finding from Suggestion to Warning when the model gives evidence:
`dead-letter` is a Warning when the consumer can fail in this diagram, otherwise a Suggestion.

### Where it shows (UX, in the app's words)

**The count.** Under the diagram's title, in the diagram card's meta row (where "Edited, reset" sits), a muted link
**⚠ 2 warnings** (`checks-count`). It appears only when there's at least one warning. With none it's absent, never
"0 issues". Its tooltip: "Check diagram (Ctrl+K)". It hides in presentation, live view, embeds, exports and
recordings, as editing chrome does. Suggestions don't count. Clicking it opens the Checks card.

**Check diagram** opens the **Checks** card. It's in the canvas right-click (next to **Auto-layout**), in Ctrl+K
("Check diagram"), and on the count. The card is a floating card under the diagram card, the trace card's size,
and it keeps its place while you select things (it never covers the inspector):

```
Checks                                   ✕
2 warnings · 3 suggestions

⚠ Failed messages are dropped
  Payments service can fail, and orders.created.v1 has no
  dead-letter queue: messages that run out of retries are lost.
  [Add dead-letter queue]                                ⋯

⚠ Nobody reads payments.refunded.v1
  Messages pile up; nothing consumes this topic.
  [Add a consumer…]                                      ⋯

• Every request goes through one Order service
  It runs 1 replica: if it stops, Mobile checkout gets nothing.
  [Set replicas to 2]                                    ⋯
  …
1 ignored · 1 check off
```

- **A row** selects and zooms to its nodes and edges (Zoom to selection, at most 125%). Hovering a row highlights
  them, as hovering an AI turn does. The fix button is the row's one primary action; its words name the change.
  A fix that needs a choice offers chips, the way an unsure stencil does in the AI panel ("API Management · Front
  Door · Firewall / WAF").
- **⋯** has **Ignore here** (this finding only, kept in the file; an optional reason), **Turn off this check** (for
  this diagram, kept in the file) and **About this check** (two lines: why it matters, and how it decides).
- The foot says "1 ignored · 1 check off". Each opens the list to bring them back.
- **Markers** show only while the card is open: a small amber triangle (warning) or blue dot (suggestion) at the
  top-right of a node's card, or at an edge's midpoint. Never in presentation, exports or recordings. A marker's
  tooltip is the finding's title.
- **Empty state.** "Nothing to check. N checks ran." With **About checks**, which lists the rules.
- **Keyboard.** The card is one Tab stop with arrow keys between rows. Enter selects a row's nodes, and Esc closes
  the card (one level, per the Esc rule).
- **In context.** A selected node or edge with a finding shows it at the top of its inspector: the same row with
  its fix, whether or not the card is open. "Context over chrome": you meet the finding where you're working.
- **When.** Checks run after edits, debounced to about 400 ms, in idle time. The checks code is a lazy chunk loaded
  once the canvas is idle, so the startup bundle doesn't grow. A diagram over 1,500 nodes checks only when the card
  opens.
- **Live view.** No count and no card. Capacity has its own heat map and callout there. Checks are for editing.
  (Decided in batch 2 as written: live view, presenting and embeds show no count, and the card closes on going
  live. The agents' `check_diagram` stays available in live view.)

Budget: no top-bar control, one context-menu row, one palette entry, one floating card shown on demand.

### Ignoring and turning off, in the file

```jsonc
// DiagramFile, optional
"checks": {
  "off": ["entry-gateway"],
  "ignore": [{ "rule": "dead-letter", "target": "orders-events", "reason": "Projection rebuilds from the log" }]
}
```

A finding's identity is rule plus target id, so it survives renames and moves. An ignore whose target is gone is
dropped on save. This goes in `validateDiagram` (bounded: 100 off, 2,000 ignores, reasons up to 200 characters),
the JSON Schema and the skill (`pnpm schemas`). Copies, share links and exports keep it, as they keep everything
else.

### Rule set (start with 8)

Ids are stable, like stencil ids. Detection uses only the model: `relationOf`, `flowEdges`, `stencilRole`,
`compileTopology` (consumer groups, DLQ routes via `isDlqEdge`) and `analyzeCapacity`.

| #   | Id                | Title (copy)                                                           | Default                                                      | Fix                                     |
| --- | ----------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| 1   | `dead-letter`     | **Failed messages are dropped** / **{queue} has no dead-letter queue** | Warning with failure evidence; else Suggestion (queues only) | **Add dead-letter queue**               |
| 2   | `no-reader`       | **Nobody reads {topic}** / **Dead letters pile up in {dlq}**           | Warning / Suggestion                                         | **Add a consumer…** / **Add a reader…** |
| 3   | `sync-cycle`      | **Requests go round in a circle**                                      | Warning                                                      | **Make {edge} a message**               |
| 4   | `sync-chain`      | **{n} requests deep**                                                  | Warning                                                      | **Make {edge} a message**               |
| 5   | `shared-database` | **{service} reads {owner}'s database**                                 | Warning                                                      | **Ask {owner} instead**                 |
| 6   | `entry-gateway`   | **{client} calls {service} directly**                                  | Suggestion                                                   | **Put a gateway in front** (chips)      |
| 7   | `capacity`        | **{node} can't keep up**                                               | Warning                                                      | **Apply fix** (the capacity suggestion) |
| 8   | `single-point`    | **Every request goes through one {node}**                              | Suggestion; Warning at ≥ 80% utilization                     | **Set replicas to 2**                   |

Batch 3's precision gate tightened three of them (see "Batch 3: precision gate"): `shared-database` is a Suggestion
when several services in the boundary share the store, `entry-gateway` fires only in a diagram that draws a way in
(and its fix goes through it first), and `single-point` needs the diagram to say one replica (or capacity to say
it's busy).

Batch 4 (both asked for; they needed a little more model first, see "Batch 4: as built"):

| #   | Id                | Title                                             | Default    | Fix                                       |
| --- | ----------------- | ------------------------------------------------- | ---------- | ----------------------------------------- |
| 9   | `secret-identity` | **{n} services read secrets without an identity** | Suggestion | **Add a managed identity** (vendor-aware) |
| 10  | `schema-registry` | **Avro on {topic}, but no schema registry**       | Warning    | **Add Schema Registry**                   |

#### 1. `dead-letter`: Failed messages are dropped

- **Why.** In the simulation (and in production), a message that keeps failing is redelivered up to the broker's
  `maxDeliveryCount` and then goes to the DLQ route, or is **dropped** when there isn't one (`docs/SIMULATION.md`).
  SQS: a DLQ "isolates unconsumed messages" ([AWS][sqs-dlq]). Service Bus has one built in, but it must be read
  ([Microsoft][sb-dlq]). On Kafka the pattern is consumer-side: retry topics and a DLT (Spring's `@RetryableTopic`,
  Kafka Connect's `errors.deadletterqueue.topic.name`), and retry topics give up ordering ([Confluent][cf-err],
  [Spring][spring-rt]).
- **Detects.** A broker (queue, topic or stream) with ordinary routes to processors, no **effective** DLQ route,
  and not itself a DLQ target. Effective is what playback does (`deadLetterRoutes` in `src/sim/topology.ts`, used by
  the engine and the check): a message that runs out of deliveries takes the broker's first dead-letter route if
  that route's filter accepts its type, and is dropped otherwise, whether the consumer requeues or retries in place.
  A consumer's own dead-letter edge catches none of them. (Built in batch 1; the plan had counted consumer-side
  routes too, which hid real loss.)
  - **Warning** when a consumer can fail in this diagram: `failureRate > 0`, or a saved simulation's setup or
    timeline sets a failure rate or takes it down.
  - **Suggestion** for a queue without that evidence: a command queue is where losing messages hurts most.
  - Topics and streams without failure evidence: no finding. Projections and connectors replay from the log, so
    a missing DLT is often deliberate.
- **False positives.** Consumers that retry forever in place (`retry: "inplace"` with no limit) or that log and
  skip on purpose. Ordered streams, where a DLT breaks order, so Confluent's "stop on error" is legitimate. Ignore
  covers these, with a reason.
- **Fix: Add dead-letter queue.** Adds a broker of the same family, connected by a DLQ route
  (`props.dlq: true`):
  - Service Bus: "{name} DLQ", sublabel `$DeadLetterQueue`
  - SQS: `{name}-dlq`
  - Kafka: `{name}.dlq`
  - RabbitMQ: a queue on a dead-letter exchange, `{name}.dlq`
  - anything else: a generic queue

  It lands one gap beside the broker (`placeNew`), and it's one undo step.

#### 2. `no-reader`: Nobody reads {topic}

- **Why.** A broker with producers and no consumers only grows. In the simulation its capacity is zero and its
  backlog climbs. Service Bus asks you to "ensure that all messages sent to the topic have at least one matching
  subscription" ([Microsoft][sb-dlq]).
- **Detects.** A broker with incoming flows and no ordinary outgoing route. **Warning**. If it _is_ a DLQ target,
  it's a **Suggestion** instead, "Dead letters pile up in {dlq}": Service Bus has "no automatic cleanup of the
  DLQ" ([Microsoft][sb-dlq]), so someone should read or alert on it.
- **False positives.** A topic consumed by systems outside the diagram (an audit, another team). Ignore with a
  reason ("read by the data platform"). The DLQ variant fires on 3 examples by design, which is why it's a
  Suggestion.
- **Fix: Add a consumer…** opens quick-add downstream of the broker (the Alt+→ flow), so you pick what reads it.
  The DLQ variant's **Add a reader…** works the same way.

#### 3. `sync-cycle`: Requests go round in a circle

- **Why.** A cycle of synchronous requests (A calls B, which calls A) is a distributed-monolith trait: a slow call
  can hold both, and timeouts and retries multiply around the loop ([archman.dev][distmono]).
- **Detects.** Strongly connected components (Tarjan, linear time) over sync flow edges. One finding per component
  of two or more nodes, or a self-loop. Dependencies and messages don't count.
- **False positives.** A callback modelled as a request (a webhook back to the caller). Drawing the callback as a
  message is more accurate anyway.
- **Fix: Make {edge} a message.** It turns the edge that closes the loop into a message: the edge into the
  component's first node in reading order, so the choice is predictable. The row also lists the loop ("Order
  service → Pricing → Order service").

#### 4. `sync-chain`: {n} requests deep

- **Why.** Each synchronous hop multiplies availability and adds latency. Availability is "serviceAvailability ^
  numberOfSynchronouslyCollaboratingServices" ([microservices.io][selfcontained]); AWS gives 3 × 99.99% ≈ 99.97% as
  the ceiling ([AWS][aws-avail]). Azure warns that chains "can add latency that's too high"
  ([Azure][az-chains]).
- **Detects.** The longest path of sync edges between **processors** only (service to service). Calls from a client
  or gateway and calls into a store aren't counted, since browser → gateway → API → database is normal. Fires at
  **4 or more** hops (five services in a row). Computed on the condensation of the sync graph (cycles collapsed),
  so it's linear and never explores paths exponentially.
- **False positives.** Low: none of the 16 examples has even 2 service-to-service sync hops.
- **Fix: Make {edge} a message**, offered for the chain's last hop. The row says what that means: "Storefront stops
  waiting for Notification service".
- **As built (batch 3).** One finding per chain start (`sync-chain:{first service}`), and one per last hop: when two
  starts share a last hop, the longer chain keeps it. A loop on the way counts as one stop (`sync-cycle` reports it),
  a self-loop as none. The row lists the chain ("Storefront API → Orders → … → Notifications: each waits for the
  next, so all 5 must be up").

#### 5. `shared-database`: {service} reads {owner}'s database

- **Why.** Database per service: "Keep each microservice's persistent data private to that service and accessible
  only via its API" ([microservices.io][dbps]). A second boundary reading it couples deploys and schemas.
- **Detects.** A store in boundary B that a processor in B uses (the owner), and that a processor outside B also
  has a flow to. Boundaries often mean a network or a cloud (AKS, a VNet), not a team. So a store in a boundary with
  no processor of its own (a "Data" tier) never fires. That one condition removes the only false positive the loose
  version had on the examples (Orders API in AKS → orders-db in Azure).
- **False positives.** A boundary that's a network around one team's services and a shared DB. Ignore.
- **Fix: Ask {owner} instead.** It replaces the foreign edge with a request to the owner service, and keeps the
  label. Offered only when there's exactly one owner.
- **As built (batch 3).** The finding is about the connection (`shared-database:{edge}`), one per outside service and
  store. Owners and users are services: connectors, loaders and transforms (Kafka Connect, Airbyte, Snowpipe, dbt,
  Data Factory, Dataflow, Flink), telemetry collectors and model APIs never count, and a flow out of the store
  (CDC reading its log) isn't a use. Warehouses, lakes and object storage (Snowflake, BigQuery, Redshift, Databricks,
  S3, Blob Storage) are shared by design and never fire. A Warning with one owner; with several, a Suggestion
  without a fix, since a boundary that several services already share is more likely a network than a team. The
  title says "uses" rather than "reads": the flow can be a write.

#### 6. `entry-gateway`: {client} calls {service} directly

- **Why.** Azure: "force all traffic from the internet to go through an NVA or a web application firewall"
  ([Microsoft][az-net]). AWS SEC05-BP03 puts AWS WAF in front of API Gateway, CloudFront or ALB ([AWS][aws-waf]).
- **Detects.** A flow from a client stencil (`client.*`, `generic.webhook`) to a self-hosted service (`service.*`,
  `k8s.*`, `docker.container`, `generic.service`, `grpc`, AKS, GKE, ECS). Managed platforms with their own front
  door (Cloud Run, Container Apps, Functions, Lambda, Static Web Apps, Vercel, Netlify, Workers) don't fire.
- **Why a Suggestion.** It fires on 4 of the 16 examples. Diagrams often leave the gateway out on purpose, to stay
  at a higher level. Owner's call (see "Open questions").
- **Fix: Put a gateway in front.** It inserts a gateway on the edge (`insert_between`, the same rule as dropping a
  node on an edge). Chips by vendor family:
  - Azure: API Management, Front Door
  - AWS: API Gateway
  - GCP: Cloud Load Balancing
  - otherwise: Firewall / WAF, Kong

  Several clients calling services of one family share one gateway.

- **As built (batch 3).** The gate (see "Batch 3: precision gate") found the plan's version fired on 4 examples, and
  only one was worth fixing: the others leave ingress out to stay at the level of their story. It now fires only when
  the diagram draws a **way in** that an outside client reaches (a gateway, load balancer, CDN or firewall, through
  DNS if need be; DNS, a mesh and SignalR aren't a way in) and another outside client goes around it: a bypass, not
  a level of detail. Outside clients are `client.*` sources but an on-call engineer (`client.team`), and
  `generic.webhook`. One finding per service, naming every client that calls it directly. The fix's button goes
  through an existing way in whose one route already goes to the service ("Go through Commerce gateway": each direct
  call becomes a call to it); the vendor family's new gateways are chips under it ("or Firewall / WAF · Kong
  Gateway"), each inserting one gateway that every direct caller shares. Only when that keeps every flow as it was
  (plain connections of one kind); otherwise no fix, and the row says why (see "Batch 3: as built").
- **The gap: a diagram that draws no gateway at all.** A client calling a self-hosted service directly, with no way in
  drawn anywhere, stays quiet. In the batch 3 gate, 3 of the 4 such hits were diagrams leaving the gateway out on
  purpose. **Owner's call (2026-10-13): keep it quiet; precision over recall.** No code changed.

#### 7. `capacity`: {node} can't keep up

- **Why.** The same analysis as **Show capacity**, without going live. A processor or broker over 100% at the
  diagram's own rates has a backlog that only grows.
- **Detects.** `analyzeCapacity(diagram)` with free-play rates (the sources' `ratePerSec`). One finding: the
  most utilized processor or broker, if its utilization is ≥ 1. Gateways and stores are left out because
  their capacity is a single-lane planning estimate (`docs/SIMULATION.md`). Saved simulations aren't checked:
  most of them overload something on purpose, to tell a story (the prototype counted 62 such hits). Live's capacity
  heat map is the place for those.
- **False positives.** As good as the inputs. A diagram with no rates set uses defaults, so the row says "at the
  diagram's own rates (2/s per source)".
- **Fix: Apply fix.** The capacity callout's rule, for this node: raise replicas, or add partitions when replicas
  sit idle.

#### 8. `single-point`: Every request goes through one {node}

- **Why.** "Only one replica" is a stock rule: Polaris `deploymentMissingReplicas`, kube-linter
  `minimum-three-replicas` ([Polaris][polaris], [kube-linter][kubelinter]). Redundancy is what turns 99.9% into
  99.9999% ([AWS][aws-avail]). Our version adds the graph: it fires only when the node is the only way through.
- **Detects.** A self-hosted processor or gateway with `replicas` ≤ 1 (the default) that **dominates** an entry
  point's request path: every sync path from that entry goes through it, and removing it leaves the entry reaching
  nothing. Uses a dominator tree over sync edges (near-linear), not a search per node. It doesn't fire for:
  - managed gateways (Front Door, API Gateway, Cloudflare, API Management, load balancers, CDN, DNS)
  - serverless and PaaS compute
  - async consumers: a broker buffers for them, so their outage is a backlog, not a failure

  **Warning** when `capacity` also puts it at ≥ 80% utilization. That's the "single point of failure under
  simulated load".

- **False positives.** A diagram that doesn't model replicas at all. The fix makes the model say so, which also
  makes the simulation more honest.
- **Fix: Set replicas to 2.**
- **As built (batch 3).** The gate found the plan's version fired 7 times on the examples and never where an owner
  would set replicas: an unset count is the default, not a claim that one instance runs. It now needs evidence: a
  **Suggestion** when the diagram says `replicas: 1`, a **Warning** when the capacity analysis (settled, at the
  diagram's own rates) puts the node at 80% or more, replicas said or not. "Only way through" is per entry point
  (each source with requests): the node dominates every end of the entry's request paths (a node with no request
  onward), from Cooper-Harvey-Kennedy dominators per entry. Entries with the same first hops share one search, and
  the searches stop at 250,000 nodes and edges visited, which only a pathological diagram (hundreds of entries, each
  with its own first hop into one large graph) reaches. A busy node's fix sizes to capacity planning's 55%
  ("Set replicas to 3"), as the capacity fix does.

#### 9. `secret-identity`: {n} services read secrets without an identity

- **Why.** Azure: managed identities "eliminate the need to store credentials" ([WAF][az-secrets]). AWS SEC02-BP02:
  use temporary credentials and roles ([AWS][aws-sec02]). The diagram should say how a service signs in to the
  vault.
- **Detects.** A node with a **Secret** dependency to a secret store (Key Vault, Vault, Secrets Manager, Secret
  Manager, generic) and no **Identity** dependency. Config stores are left out because their secret edge is a
  _reference_: App Configuration never calls Key Vault itself (`diagram-semantics.md`). So are Kubernetes Secrets,
  which the kubelet mounts. **One aggregated finding per diagram**, not one per service: on the examples it would
  otherwise fire 7 times across 5 diagrams, because no example draws identity yet.
- **Fix: Add a managed identity.** One identity node, connected from each service by an Identity dependency:
  - Key Vault: `azure.managed-identity`
  - Secrets Manager: `aws.iam-role`
  - otherwise: `generic.identity-provider`

  The catalog has no GCP service account stencil; add one in the same batch.

- **As built (batch 4).** The gate (see "Batch 4: precision gate") cut the plan's 5 findings to 1. It fires only where
  the identity has a name: the service's cloud (its stencil, or its boundary's tone), else the store's. Key Vault,
  Secrets Manager and Secret Manager always have one; a HashiCorp Vault or generic store read by a service on no cloud
  doesn't fire (it signs in with Vault's own methods, which the diagram has no node for). Words that already say it
  ("managed identity", "workload identity", "IAM role", "service account", "IRSA" on the vault, the service or the
  Secret dependency) keep it quiet. People (`client.*`) don't count, nor does anything a dependency points at. The
  finding's target is the first vault in the file, so moving nodes keeps an ignore. Its elements are the vaults and
  the services, not their Secret dependencies (as chips they only repeated them). As batch 4 built it, the fix added
  one identity per cloud ("Add a managed identity"), in the services' boundary when they share one, and a chip gave
  each service its own ("One for each service"). The GCP stencil was already in the catalogue (imports batch 3), so
  it's the Google Cloud identity.
- **Owner's call (2026-10-13): one identity per service by default** (least privilege). The button gives each service
  its own ("Add managed identities", each in its service's boundary); the chip shares one ("One
  shared identity"; with services on two clouds, "One shared per cloud", offered only when a cloud has more than one
  service, since otherwise it would add the same identities). See "Owner's decisions (2026-10-13)".

#### 10. `schema-registry`: Avro on {topic}, but no schema registry

- **Why.** Confluent's Avro serializer writes a magic byte and a 4-byte schema id from the registry
  ([Confluent][cf-avro]). "Starting a project with Schema Registry is a best practice" ([Confluent][cf-sr]). It's
  not strictly required, so it's a Warning, not more.
- **Detects.** A Kafka-family topic whose `props.contentType` (written by the AsyncAPI import, see `imports.md`)
  or label says Avro or Protobuf, while the diagram has no `kafka.schema-registry` node. It needs that data, so it
  ships with the AsyncAPI import.
- **Fix: Add Schema Registry.** One node, with a **Depends on** dependency from each producer and consumer of those
  topics (the stencil's inferred relation).
- **As built (batch 4).** One Warning per diagram, naming every such topic (a registry serves them all). The Kafka
  family is `kafka.topic`, Amazon MSK and Confluent Cloud; Event Hubs is left out (Azure has its own schema registry
  there). A registry drawn any way keeps it quiet: the stencil, or a node named as one (Apicurio, Glue Schema
  Registry), connected or not; a topic is never one, and words saying it's missing ("Avro, no schema registry",
  "needs a schema registry") don't count. Producers and consumers are the topics' direct flow neighbours that aren't brokers.
  The AsyncAPI import already wrote `props.contentType` (imports batch 2), and adds a registry itself when it sees
  Avro or Protobuf, so an imported diagram warns only if the registry is taken out.

### Evidence: the prototype on the 16 public examples

A throwaway script (outside the repo, using the real `compileTopology`, `stencilRole`, `relationOf` and
`analyzeCapacity`) ran broad and refined versions of each rule. Totals across the 16 examples (212 nodes):

| Rule                                              | Broad version                 | Refined (proposed)                                                          |
| ------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| No DLQ on any consumed broker                     | 29                            | **2 warnings** (consumer fails in a saved simulation) + 7 queue suggestions |
| Nobody reads                                      | 0                             | 0, plus 3 "dead letters pile up" suggestions                                |
| Sync cycle                                        | 0                             | 0                                                                           |
| Service-to-service sync chain ≥ 4 (or even ≥ 2)   | 0                             | 0                                                                           |
| Cross-boundary store access                       | 1 (a network boundary: false) | **0** (owner-in-boundary condition)                                         |
| Client straight to a service                      | 6                             | **4** (managed ingress excluded)                                            |
| Over capacity (all nodes, every saved simulation) | 74                            | **1** (most utilized processor or broker, free play)                        |
| Single replica cutting entry → end paths          | 14                            | **4** (sync request path, self-hosted only)                                 |
| Secret without identity                           | 8                             | **1 per diagram** (aggregated), 5 diagrams                                  |

The prototype took the two dead-letter warnings to be real. Building batch 1 showed only one is: the Kafka order
pipeline's "Payments service goes down" takes a consumer **down**, and a down consumer loses nothing, in the
simulation or on Kafka: its group's messages wait on the topic (lag), and the example's own expectations say all 300
payments arrive. Only a failure rate is evidence now (see below). The rest of the refined numbers held: 7 queue
suggestions, 3 "dead letters pile up", 0 loops and 1 capacity warning. The refined rules give 1 to 3 findings on a
busy example, and none on most.

### Batch 1: precision gate

Every finding the four batch 1 rules raise on the 16 public examples (`src/examples/*.json`, top level only),
judged as a senior architect would: would I change the diagram as the finding asks? The list is pinned by
`src/checks/examples.test.ts`, so a change to it is a change to this table. To re-judge, change a verdict here and
recount the numbers below.

| #   | Example                       | Finding (rule: target)              | Severity   | Verdict      | Why                                                                                                                                                                                                                              |
| --- | ----------------------------- | ----------------------------------- | ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | azure-service-bus-integration | `dead-letter`: ledger-posting       | Warning    | Would fix    | "Poison invoices" makes the ledger worker fail every message. Its other input (invoice.commands) has a DLQ drawn; this subscription doesn't, so in the model its poison invoices vanish after 10 deliveries. Show where they go. |
| 2   | azure-service-bus-integration | `dead-letter`: approval-workflow    | Suggestion | Would fix    | Invoices over 10,000 waiting for approval are the last thing to lose silently. The owner already gave invoice.commands a DLQ for the same reason.                                                                                |
| 3   | aws-fanout                    | `dead-letter`: order-archive        | Suggestion | Would fix    | SQS to Lambda with no redrive policy: a poison batch retries until retention ends, then the archive has a gap. AWS's guidance gives every Lambda SQS source a DLQ.                                                               |
| 4   | aws-fanout                    | `dead-letter`: order-receipts       | Suggestion | Would fix    | Its sublabel says "retry limit: 5", which only exists with a redrive policy: the DLQ is implied but not drawn (fulfillment-orders draws its own).                                                                                |
| 5   | notification-fanout           | `dead-letter`: email                | Suggestion | Would fix    | Shipping emails are customer-facing. A template or SendGrid rejection should land where someone can see and replay it.                                                                                                           |
| 6   | notification-fanout           | `dead-letter`: sms                  | Suggestion | Would fix    | Twilio rejections (bad numbers, carrier filtering) need a parking place, and the diagram's own "SMS outage" story is about this path.                                                                                            |
| 7   | notification-fanout           | `dead-letter`: push                 | Suggestion | **Wouldn't** | Push is best-effort. A dead-lettered "your order shipped" push is stale by the time anyone replays it, so dropping is the right policy. Ignore, with that reason.                                                                |
| 8   | rag-assistant                 | `dead-letter`: Ingest jobs          | Suggestion | Would fix    | A page whose embedding fails drops out of the index silently. A DLQ of failed ingest jobs is how you notice the index drifting.                                                                                                  |
| 9   | aws-fanout                    | `no-reader`: fulfillment-orders-dlq | Suggestion | Would fix    | Nothing reads or alerts on it. "Redrive after 5 failed receives" says how messages get in, not how they get out. Add the alarm and redrive path.                                                                                 |
| 10  | azure-service-bus-integration | `no-reader`: invoice.commands DLQ   | Suggestion | **Wouldn't** | The owner already wrote the answer in text: the DLQ says "operator replay" and Integration telemetry says "DLQ alerts". The right edit is a line to that existing node; **Add a reader…** would add a new one.                   |
| 11  | outbox-saga-checkout          | `no-reader`: payments.commands.dlq  | Suggestion | Would fix    | "Replayable", but nothing replays it. A payment command parked there is a checkout stuck halfway through the saga; someone has to be told.                                                                                       |
| 12  | iot-telemetry                 | `capacity`: Device state projector  | Warning    | Would fix    | At the diagram's own 2,000 readings/s, one projector (128 at once × 150 ms ≈ 853/s) runs at 234%. Free play shows a red bottleneck the design doesn't mean (Event Hubs triggers scale out per partition). **Set replicas to 5**. |
| –   | kafka-order-pipeline          | `dead-letter`: orders.created.v1    | Warning    | **Wouldn't** | Raised only before tuning, while "goes down" counted as evidence. A down consumer leaves its messages on the topic (lag, not loss), in the simulation as on Kafka. Removed by tightening; not counted below.                     |

**Numbers, after tightening**

| Rule          | Findings | Would fix | Precision | Warnings          | Suggestions   | Outcome                                                                                     |
| ------------- | -------- | --------- | --------- | ----------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `dead-letter` | 8        | 7         | 88%       | 1 of 1 (100%)     | 6 of 7 (86%)  | Tightened: only a failure rate is evidence. The part under 90% is already a Suggestion.     |
| `no-reader`   | 3        | 2         | 67%       | none fired        | 2 of 3 (67%)  | All three are the dead-letter-queue variant, already a Suggestion. The Warning never fired. |
| `sync-cycle`  | 0        | –         | –         | –                 | –             | No example has a loop of requests. Unit tests cover it; no precision to measure yet.        |
| `capacity`    | 1        | 1         | 100%      | 1 of 1 (100%)     | –             | Stays a Warning.                                                                            |
| **All**       | **12**   | **10**    | **83%**   | **2 of 2 (100%)** | 8 of 10 (80%) |                                                                                             |

**What the gate changed** (the review round in batch 1 re-ran it: the same 12 findings and verdicts)

- `dead-letter`: a consumer that's down or paused is no longer failure evidence; only a failure rate is (on the node,
  or set by a saved simulation's setup or timeline). That removed the Kafka warning above: the rule went from 7 of 9
  (78%) to 7 of 8 (88%), and its Warning tier from 1 of 2 to 1 of 1.
- `capacity`: it reads the diagram as live view's capacity planning does, with gateways and stores unlimited. The raw
  analysis had put Event Hubs at 30,000%, because the Databricks store behind it was costed as a single lane. Now
  the finding is the projector, the same bottleneck live view shows.
- The two rules still under 90% (`dead-letter` at 88%, `no-reader` at 67%) are under it only in their Suggestion
  tiers, which is the demotion the gate asks for. Nothing in the model tells their misses from their hits (an email
  queue and a push queue look the same, and the Service Bus DLQ's handling is only in free text), so tightening
  further would cost true findings. **Ignore here** (with a reason) and **Turn off this check** cover them.
- `dead-letter` after review: only an **effective** broker route suppresses it (see Detects above). A consumer's own
  dead-letter edge no longer hides loss, and a broker route whose filter misses the failing types counts as no route
  (its fix lets the route take every failed message). No example has either shape, so the table didn't change; unit
  tests assert loss in a seeded run for each case.
- `capacity` after review: planning and the fix are one shared module, `src/sim/capacityPlanning.ts`, used by live
  view's Show capacity and by the check, so the two can't drift. The finding and its fix are unchanged.
- Every Warning is at 100%. Batch 2's count under the title would show 2 warnings across all 16 examples.

### Batch 3: precision gate

The same judgment for the four batch 3 rules, on the same 16 public examples (top level only): would I change the
diagram as the finding asks? First as the plan described them, then as built. `src/checks/examples.test.ts` pins the
built rules' findings (none), so a change to that list is a change to this table.

**As built, the four rules raise nothing on the examples.** Every finding below was raised by the plan's version and
removed by tightening; none is counted in the batch 1 numbers, which are unchanged (12 findings, 2 warnings).

| #   | Example                    | Finding (rule: target), as planned                   | Severity   | Verdict      | Why                                                                                                                                                                                                                            |
| --- | -------------------------- | ---------------------------------------------------- | ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| –   | event-driven-data-platform | `entry-gateway`: webhook-receiver (Billing webhooks) | Suggestion | **Wouldn't** | The diagram is about the data platform; it draws no ingress anywhere. The receiver's signature check ("Verify signature") is the control Stripe asks for, and a gateway box would say nothing about the platform.              |
| –   | event-driven-data-platform | `entry-gateway`: checkout (Storefront)               | Suggestion | **Wouldn't** | Same diagram: the checkout is there as the source of order events.                                                                                                                                                             |
| –   | outbox-saga-checkout       | `entry-gateway`: order-api (Mobile checkout)         | Suggestion | **Wouldn't** | The story is the outbox and the saga after the order is written. A gateway would be true of the real system and add nothing to this one.                                                                                       |
| –   | rag-assistant              | `entry-gateway`: rag-api (Help center chat)          | Suggestion | Would fix    | Anonymous chat traffic straight into an API that calls a paid model: a rate limit in front is cost control, not detail. The one real gap; lost by the tightening (see below).                                                  |
| –   | cqrs-event-sourcing        | `single-point`: gateway (Kong, Banking app)          | Suggestion | **Wouldn't** | No node in the diagram sets replicas: the default 1 isn't a claim that one instance runs. Setting 2 on the gateway alone makes the model inconsistent, not more honest.                                                        |
| –   | event-driven-data-platform | `single-point`: webhook-receiver (Billing webhooks)  | Suggestion | **Wouldn't** | Replicas are set only where throughput is the point (Snowpipe ×6); the receiver is context.                                                                                                                                    |
| –   | event-driven-data-platform | `single-point`: checkout (Storefront)                | Suggestion | **Wouldn't** | Same.                                                                                                                                                                                                                          |
| –   | kafka-order-pipeline       | `single-point`: gateway (Commerce gateway, NGINX)    | Suggestion | **Wouldn't** | No node sets replicas. The diagram's outage stories are about consumers and lag, not its front door.                                                                                                                           |
| –   | kafka-order-pipeline       | `single-point`: orders (Order service)               | Suggestion | **Wouldn't** | Same diagram, same reason.                                                                                                                                                                                                     |
| –   | outbox-saga-checkout       | `single-point`: order-api (Mobile checkout)          | Suggestion | **Wouldn't** | No replicas anywhere; the story is the write and the relay.                                                                                                                                                                    |
| –   | rag-assistant              | `single-point`: rag-api (Help center chat)           | Suggestion | **Wouldn't** | The closest call. The embed worker's 4 replicas are about throughput (competing workers), not a statement that everything else runs one. A second replica would be right in production, but the diagram doesn't say otherwise. |

`sync-chain` and `shared-database` raised nothing in either version. The longest service-to-service chain on the
examples is one request (RAG API → Claude API, Eval job → Claude API, Chunk and embed → Embeddings API).
`shared-database` without its owner condition would raise 4, all false: orders-db in the Azure boundary with the
Orders API in AKS (a network boundary, the plan's example), and three Snowflake stores in boundaries that hold no
service of their own (loaded and transformed by Snowpipe, Airbyte and dbt). The owner condition removes all four; the
warehouse and connector exclusions would each remove the Snowflake ones again.

**Numbers**

| Rule              | As planned | Would fix | Precision | As built | Outcome                                                                                              |
| ----------------- | ---------- | --------- | --------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `sync-chain`      | 0          | –         | –         | 0        | Warning at 4 hops, as planned. Unit tests cover it; no precision to measure yet.                     |
| `shared-database` | 0          | –         | –         | 0        | Warning with one owner, Suggestion with several. Warehouses and connectors excluded.                 |
| `entry-gateway`   | 4          | 1         | 25%       | 0        | Tightened: only when the diagram draws a way in that another client goes around. Stays a Suggestion. |
| `single-point`    | 7          | 0         | 0%        | 0        | Tightened: a Suggestion only when the diagram says one replica; a Warning at 80% busy or more.       |
| **All four**      | **11**     | **1**     | **9%**    | **0**    | The count under the title shows the same 2 warnings across the 16 examples as after batch 1.         |

**What the gate changed**

- `entry-gateway`: the plan's version (any outside client calling a service you run) fired on 4 examples at 25%,
  under the bar even for a Suggestion. What separates a gap from a level of detail is whether the diagram draws
  ingress at all, so it now fires only for a client that goes **around** a way in the diagram draws. That costs
  rag-assistant's real gap (a diagram with no gateway anywhere): the trade is noise on most sketches against that
  one, and the owner can reconsider it. Its fix's default goes through the existing way in.
- `single-point`: 0 of 7 as planned. Every hit was an unset replica count read as "1". Now only a said `replicas: 1`
  (Suggestion) or capacity evidence (Warning) fires. The Kubernetes and docker-compose imports now write a count
  the file sets, one included (see "Imports" below).
- `shared-database` and `sync-chain`: the plan's thresholds hold. `shared-database` gained the warehouse and
  connector exclusions (they'd catch the Snowflake boundaries if the owner rule were ever loosened) and its
  several-owners Suggestion tier.
- No Warning fires on the examples, so every Warning is still at 100%.

#### Imports

The import follow-ups (October 2026) made the Kubernetes and docker-compose imports write `replicas: 1` when the
file says one, so `single-point` can see an imported one-replica Deployment, the case kube-linter's
`minimum-three-replicas` flags. What a count means, as built:

| Source                            | Writes `replicas`                                                                                                                                                                           | Unset                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Kubernetes workload               | `spec.replicas`, 1 included (0 isn't a count to draw)                                                                                                                                       | stays unset                           |
| …with an HPA or KEDA ScaledObject | The autoscaler's floor when the file sets it (`minReplicas`, `minReplicaCount`), 1 included; a higher `spec.replicas` stays. The manifest's own 1 is dropped: the autoscaler owns the count | stays unset (the HPA's default 1 too) |
| docker-compose                    | `deploy.replicas` or `scale`, 1 included, after the file's own `${VAR:-default}`                                                                                                            | stays unset                           |
| Terraform                         | not read (see below)                                                                                                                                                                        | –                                     |

- **Unset stays unset.** Kubernetes and Compose both run one replica when the count is left out, and kube-linter
  reads a missing `spec.replicas` as 1. But the precision gate's finding holds for imports too: a GitOps base leaves
  the count out for a Kustomize overlay or an autoscaler in another file to set, and a compose file is mostly one
  developer's machine. Reading those as "one" would fire on exactly the files where it's wrong. `kubectl get -o
yaml` output always has the count (the API server fills it in), so a dump of a live cluster is read as it runs.
- **An autoscaler owns the count.** kube-score and KICS ask that a Deployment an HPA scales not set `replicas` at
  all, since applying the manifest resets it. So under an autoscaler only its own floor is evidence: a stated
  `minReplicas: 1` is one replica at quiet times (Polaris's `hpaMinAvailability` flags it), a `minReplicaCount: 0`
  or a missing minimum isn't one.
- **Terraform** isn't changed. The reader doesn't read ECS `desired_count`, App Service or Container Apps minimum
  replicas, and a plan's `values` carry the provider's default whether or not the configuration set it (a state has
  no configuration at all), so "the file says one" can't be told from "nobody said". Serverless and PaaS compute,
  which most of those are, don't count for `single-point` anyway.

**Findings on the import fixtures, before and after.** `src/interop/infra/checks.test.ts` pins them, as
`examples.test.ts` does for the examples.

| Fixture                                    | Before | After | New findings                                                                                                                                                    |
| ------------------------------------------ | ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| compose (`docker-compose.yml`)             | 1      | 1     | None. No service says `replicas: 1`; `payments-worker` says 3.                                                                                                  |
| Kubernetes (the five files)                | 1      | 1     | None. Three nodes now say one replica: PostgreSQL and Redis are stores, and `payments-worker` (KEDA floor 1) consumes from a topic, so a broker buffers for it. |
| AsyncAPI (the three documents)             | 5      | 5     | None (no replicas in AsyncAPI).                                                                                                                                 |
| Terraform AWS plan, and Draw everything    | 1, 1   | 1, 1  | None.                                                                                                                                                           |
| Terraform Azure state, and Draw everything | 2, 2   | 2, 2  | None.                                                                                                                                                           |

The findings that were there (`no-reader` on topics nobody in the files reads, `dead-letter` on a subscription
without one) are unchanged. With no new finding, there was nothing to judge as noise and the rule's condition isn't
changed. Where it does fire, unit tests pin it: an Ingress to a one-replica NGINX Deployment, and a compose proxy with
`deploy.replicas: 1` in front of a two-replica API, each raise "Every request goes through one …" as a Suggestion
(**would fix**: it's kube-linter's case, on the only way in), and the same files with the count unset, above one or
under an autoscaler with no floor of its own raise nothing.

**Batch 4's rules on the same fixtures.** Batch 4 (`secret-identity`, `schema-registry`) landed while this was built.
On the import fixtures as they were, `secret-identity` raised three findings, all false, and `schema-registry` none
(the AsyncAPI import adds a registry when its messages use Avro or Protobuf).

| Fixture                          | Finding (rule: target)                                  | Verdict      | Why, and what changed                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terraform Azure state            | `secret-identity`: shop-kv (billing-func)               | **Wouldn't** | The Function App has a system-assigned identity, and its Secret relationship to the vault comes from a role assignment to that very identity ("Key Vault Secrets User"). The import knew and didn't say. It now labels a Secret or Config connection that comes from a grant to the component's own identity "managed identity", which the rule already reads as said. |
| Terraform Azure, Draw everything | the same                                                | **Wouldn't** | Same, same fix.                                                                                                                                                                                                                                                                                                                                                        |
| Terraform AWS, Draw everything   | `secret-identity`: orders/db-credentials (db, a helper) | **Wouldn't** | `db` is a `random_password` and a secret version, drawn only by Draw everything: they are the secret's value, not a service reading it. Supporting resources there now refer to things as plain Depends on, never Identity, Secret or Config.                                                                                                                          |

Both fixes are in the import, not the rule: the rule's reading was right for what the diagrams said, and what they said
was wrong or incomplete. With them, the findings on every import fixture are the ones before batch 4.

### Batch 4: precision gate

The same judgment for `secret-identity` and `schema-registry`, on the same 16 public examples (top level only): would
I change the diagram as the finding asks? First as the plan described them, then as built.
`src/checks/examples.test.ts` pins the built rules' findings, so a change to that list is a change to this table.

| #   | Example                       | Finding (rule: target)                                        | Severity   | Verdict      | Why                                                                                                                                                                                                                                                                                        |
| --- | ----------------------------- | ------------------------------------------------------------- | ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 13  | notification-fanout           | `secret-identity`: key-vault (Email sender, SMS rate limiter) | Suggestion | Would fix    | Both run on Azure and read provider API keys from notify-kv. The diagram draws its secrets on purpose, and what opens the vault is the one thing missing: on Azure that's a managed identity (Key Vault references need one). The AKS example draws exactly this. Kept, as built.          |
| –   | azure-service-bus-integration | `secret-identity`: vault (Invoice intake)                     | Suggestion | **Wouldn't** | The vault's sublabel already says "ERP credentials · managed identity": the owner wrote the answer, as with batch 1's #10. A node would repeat it. Removed by tightening: words that say how a service signs in count.                                                                     |
| –   | outbox-saga-checkout          | `secret-identity`: vault (Payment service)                    | Suggestion | **Wouldn't** | HashiCorp Vault, and nothing says where the service runs. It signs in with one of Vault's own methods (Kubernetes, AppRole), which has no node; the plan's fallback, a generic identity provider, would be a box that says nothing true. Removed: Vault needs the service's cloud to fire. |
| –   | rag-assistant                 | `secret-identity`: vault (RAG API, Chunk and embed)           | Suggestion | **Wouldn't** | Same: Vault, and no platform drawn. The story is retrieval and evals.                                                                                                                                                                                                                      |
| –   | webhook-ingestion             | `secret-identity`: vault (Webhook receiver)                   | Suggestion | **Wouldn't** | Vault sits in the Kubernetes boundary with the receiver, which signs in with its pod's service account (Vault's Kubernetes auth): the platform gives every pod one. An identity provider box would be wrong. Removed by the same condition.                                                |

`schema-registry` raised nothing in either version. No Kafka topic in the examples says Avro or Protobuf, in its
label or `contentType`. The three examples that use Avro on Kafka (cdc-analytics, event-driven-data-platform,
kafka-order-pipeline) draw a registry, and say "Avro" only on it. The one other Avro is gcp-streaming-analytics' raw
archive in Cloud Storage ("Avro · by hour"): Avro files carry their own schema, which is why only Kafka-family topics
count. Its precision is unmeasured on the examples; unit tests and the AsyncAPI round trip cover it.

**Numbers**

| Rule              | As planned     | Would fix | Precision | As built | Would fix | Outcome                                                                                      |
| ----------------- | -------------- | --------- | --------- | -------- | --------- | -------------------------------------------------------------------------------------------- |
| `secret-identity` | 5 (7 services) | 1         | 20%       | 1        | 1 (100%)  | A Suggestion, once per diagram. Fires only where the identity has a name and isn't said yet. |
| `schema-registry` | 0              | –         | –         | 0        | –         | A Warning, as planned. No example has Avro or Protobuf on Kafka without a registry.          |
| **Both**          | **5**          | **1**     | **20%**   | **1**    | **1**     | The count under the title still shows 2 warnings across the 16 examples.                     |

**What the gate changed**

- `secret-identity`: the plan's version fired on 5 of the 16 examples, and only one was worth fixing. The misses were
  of two kinds. Three read HashiCorp Vault from services on no cloud, where the identity has no node to draw (the
  plan's generic identity provider would be a wrong box, not a missing one). One already said "managed identity" in
  words. So it now needs the service's cloud (its stencil or its boundary), or a cloud store's, and stays quiet when
  the vault, the service or the dependency says how it signs in. The trade: a hand-drawn Vault on AWS with no
  boundary goes unflagged, in return for silence on every Vault sketch.
- `schema-registry`: the plan's thresholds hold. Only Kafka-family topics count (the Cloud Storage archive would
  otherwise fire on Avro files, which carry their schema), and a registry drawn any way, named or unconnected,
  counts as present.
- Every Warning is still at 100%: the only new Warning, `schema-registry`, doesn't fire on the examples.

### Agents: `check_diagram` (WebMCP)

One read-only tool. It's published in editing and live view, like `describe_diagram`. It's unavailable for private
diagrams, as every AI tool is.

```jsonc
// input
{ "rules": ["dead-letter", "capacity"], "include": "warnings" | "all" }   // both optional; default "all"
// output (kept under the 1.5K-character budget; long lists summarised)
{
  "findings": [
    {
      "id": "dead-letter:orders-events",
      "rule": "dead-letter",
      "severity": "warning",
      "title": "Failed messages are dropped",
      "targets": ["orders-events", "payments"],
      "fix": {
        "label": "Add dead-letter queue",
        "ops": [
          { "op": "add_node", "kind": "kafka.topic", "label": "orders.created.v1.dlq" },
          { "op": "connect", "from": "orders-events", "to": "$0", "props": { "dlq": true } }
        ]
      }
    }
  ],
  "summary": "2 warnings, 3 suggestions; 1 ignored."
}
```

- The agent applies a fix with `edit_diagram` and those ops, so the change is an ordinary turn in the AI panel:
  Undo, highlight, "+1 node, +1 connection". There's no second write path.
  - Ops that need a choice (a gateway) list the default; the agent can swap the `kind`.
  - **Add a consumer…** has no ops (the person picks); the tool says "needs a choice".
- `TOOL_HELP`: "Finds likely design problems (lost messages, unread topics, overload) and how to fix them."
- **Simulation evidence** (batch 5): `simulations: true` plays the saved simulations as the card's Run simulations
  does (a worker, a minute of each, about 15 s in all) and adds their counts and `dropped` findings, within the same
  budget. A `dropped` finding never carries a `fix` (owner's call, 2026-10-13). Off by default: it costs seconds where the checks cost milliseconds.
- **Ignoring stays a person's call.** No tool writes `checks.ignore`. An agent that silences warnings is the
  failure mode to avoid.
- The skill (`skills/livediagrams/`) gets the rule table, so coding agents can run the same checks on a
  `.diagram.json` (`scripts/` already runs the app's validation).

### Code shape

- `src/checks/`: `rules/*.ts` (one per rule: `id`, `defaultSeverity`, `detect(ctx) → Finding[]`,
  `fix(finding, ctx) → DiagramOp[] | "choose"`), `run.ts` (builds a shared context once: roles, compiled topology,
  sync adjacency, SCCs, dominators, lazy capacity), `types.ts`. All pure, unit-tested per rule with tiny diagrams
  and the examples as a regression snapshot.
- UI: `ChecksCard.tsx` (lazy), a `checks` slice next to the editor's diagram state, markers through the existing
  node decorations, the count in `CanvasView`'s diagram card.
- Bundle: the checks chunk joins `NOT_AT_STARTUP` in `bundleSplit.build.test.ts`. Estimate 8 to 12 kB gzip, plus the
  capacity module, loaded when the capacity rule first runs.
- Performance: every rule is O(V + E), except the capacity fixed point, which is already bounded at 256
  iterations. Add a perf test with a 1,500-node synthetic diagram, under 50 ms (`src/test/perfBudget.ts`). (Batch 3's
  rules are guarded by a ratio instead: the same rules on 375 and 1,500 nodes, where linear is 4× and quadratic 16×.
  Absolute budgets measured the CI machine.)

## Build batches

Each batch is its own PR and ends with the UX review gate (`docs/UX-PRINCIPLES.md` § Process; findings in
`docs/DESIGN-REVIEW.md`). They're ordered by value per effort.

1. **Engine and the four structural rules.** `src/checks/` with the shared context, plus `dead-letter`, `no-reader`,
   `sync-cycle` and `capacity`. These are the highest value with the lowest false-positive risk, and they reuse
   `compileTopology` and `analyzeCapacity` directly. Includes the regression snapshot over the examples, and
   `check_diagram` (read-only, no UI needed, so agents get value first). _Gate: the owner marks every finding on
   the examples as would or wouldn't fix._
2. **The Checks card, the count and fixes.** _(Built; see "Batch 2: as built".)_ The card, the diagram-card count, markers while open, the node
   inspector row, the canvas right-click and Ctrl+K, and fixes for batch 1's rules as ops through `applyOps` (one
   undo step, toast with Undo). Ignore and turn off, in the file (`checks` field, validator, schema, `pnpm
schemas`). _UX gate: chrome budget, keyboard, Esc order, dark theme, 1280×800, presentation and export clean._
3. **The other four starter rules.** _(Built; see "Batch 3: precision gate" and "Batch 3: as built".)_
   `sync-chain`, `shared-database`, `entry-gateway` (with stencil chips) and `single-point` (dominators, plus the
   capacity escalation), each with its fix. _Gate: the examples snapshot again._
4. **Rules that need more model.** _(Built; see "Batch 4: precision gate" and "Batch 4: as built".)_
   `secret-identity` (aggregated, plus a GCP service account stencil) and `schema-registry` (with the AsyncAPI
   import's `contentType`, see `imports.md`).
5. **Simulation evidence (on demand).** _(Built; see "Batch 5: as built".)_ In the Checks card, **Run simulations** plays each saved simulation
   headless in a worker (deterministic, seeded, capped at 60 s simulated time) and attaches counts to findings
   ("312 dropped in _Payments goes down_"). It also adds `dropped` findings that the static rules can't see. Only
   on click: it costs seconds.

## Batch 2: as built

The visible part, as the UX section describes it. What was decided while building:

- **Entry points.** The count (warnings only), the canvas right-click (**Check diagram**, after Auto-layout: 9 of
  12 rows), Ctrl+K (the same action), and a fourth the plan didn't have: **View ▸ Checks**, a toggle beside Show
  capacity and Show dependencies (9 of 12 rows), so the card can be found without a warning. The inspector's row
  has **All checks**.
- **Off the main thread.** Checks run after edits pause (400 ms), in idle time, in a worker
  (`src/checks/worker.ts`); the main thread only builds and copies the file. The first run waits 1.2 s for the
  canvas to settle. One run at a time, with only the newest diagram queued behind it
  (`src/canvas/checks/scheduler.ts`). Where workers fail, the engine loads as a lazy chunk and runs in idle time.
  Measured with Event Timing on a 1,500-node diagram with a loop of requests in each pipeline (capacity's slowest
  case): the same typing with checks running between keys and with them held, alternating, in one run
  (`tests/e2e/checks-ui.spec.ts`). The keystroke cost is the diagram's own (each one re-renders 1,500 nodes:
  ~130 ms here, ~600 ms at a fourfold CPU slowdown); checks add 0–17% to the median at that slowdown with four
  tests in parallel, from building and copying the file on the main thread. A fixed millisecond budget measured
  the machine, not the checks, which is why CI failed it.
- **What ships when.** The startup JavaScript gains only the card's open/closed store and two icons (+0.3 kB
  gzip). The canvas chunk has the scheduler, the count and the markers; the card is its own lazy chunk (3.5 kB
  gzip, plus 1.3 kB CSS), and the engine lives in the worker.
- **The card.** Under the diagram card, 340 px wide (290 px in windows up to 1,100 px), as tall as it can be above
  the canvas controls. Opening it over
  a diagram that was all in view refits the diagram clear of it (rule 10: floating panels never hide content after
  fit-view). Rows draw 40 per group, with **Show more**. Arrow keys move between rows' heads; Esc closes the card
  when nothing is selected (one level, after the selection).
- **Fixes are checked again before they apply.** A finding's fix was worked out when the check ran; clicking it
  re-runs that one rule on the diagram as it is now and applies the fix worked out then, or nothing ("Nothing to
  fix: the diagram already changed"). So a second click adds no second queue, and a capacity fix sizes from
  today's replicas. Between an edit and the next result the findings show as stale and their fix buttons wait.
- **Fixes** are `applyOps` plus one `applyDiagram` step (the same as an agent's turn), with a toast ("Added
  ledger-posting DLQ · Undo"). A fix that needs a choice opens quick-add downstream of its node. **Ignore here…**
  and **Turn off this check** are `updateMeta({ checks })`, one undo step each, with an Undo toast.
- **Private diagrams** are checked like any other; nothing leaves the device.

## Batch 3: as built

The other four starter rules, through the engine and the UI that batches 1 and 2 built. What was decided while
building:

- **Order.** `CHECK_RULES` follows the rule table: dead-letter, no-reader, sync-cycle, sync-chain, shared-database,
  entry-gateway, capacity, single-point. Findings list warnings first, then by that order, then reading order (a
  connection reads where it starts: `shared-database` is about a connection).
- **Shared graph code.** `src/checks/graph.ts` has Tarjan's components (moved from `sync-cycle`, and now shared with
  `sync-chain`) and Cooper-Harvey-Kennedy dominators. The context builds the request adjacency (`ctx.requests`) once,
  for `sync-cycle`, `sync-chain` and `single-point`. What the rules know about stencils beyond their role (self-hosted
  compute and gateways, ways in, outside clients, stores shared by design, processors that aren't services) is one
  file, `src/checks/kinds.ts`. Capacity evidence and the busy fix's size come from `analyzeCapacity` and
  `capacityPlanning` (`FIX_TARGET`), as the capacity check's do.
- **Fixes with options.** A fix can carry other ways to make the same change (`CheckFix.options`): `entry-gateway`
  puts the existing way in on its button and new gateways as chips under it ("or Firewall / WAF · Kong Gateway"). A
  chip applies like the button: checked again on the diagram as it is now, one undo step, a toast ("Added Kong
  Gateway · Undo"). Agents get them as `fix.others` (label, kind, and ops while they fit beside the default's), and
  the reply's hint says to send one's ops instead if the person prefers it.
- **Wording.** "{n} requests deep", "{service} uses {owner}'s database" (the flow can be a write, so not "reads"),
  "{client} calls {service} directly", "Every request goes through one {node}". Each row names what's involved and
  says what the fix changes ("Making the last call a message means Storefront no longer waits for Notifications").
- **Performance.** At 1,200 nodes each rule takes 1 to 3 ms on top of the shared context (single-point about 8 ms,
  most of it the capacity analysis it shares with `capacity`). `src/checks/examples.test.ts` runs the four rules on
  375 and 1,500 nodes and asserts the time ratio stays under 8 (linear is 4, quadratic 16), not a millisecond budget.
  Two quadratic spots it found were fixed: ranking the ways in once per run rather than per finding, and counting the
  connections between a pair once (`freshKey` also stopped scanning boundaries on every call).
- **What ships when.** Startup JavaScript: +29 bytes gzip (the four rule ids). The checks worker +4.1 kB gzip, the
  main-thread fallback chunk +4.2 kB, the card +0.1 kB (the chips) and a few lines of its CSS. The entry is 110.0 kB
  of its 123.5 kB budget.
- **After code review: a fix never changes traffic it doesn't mean to, nor removes what it doesn't own.** A
  one-click fix is offered only when it's lossless; otherwise the finding stays, without a button, and says why.
  - `entry-gateway` (narrowed rather than redesigned). Rerouting can't carry a flow's settings through a gateway: a
    gateway sends round-robin to its routes and ignores shares, and a split connection copies its filter, emits,
    share and timing onto both halves, which applies emits and shares twice. So the fix is offered only when every
    direct connection is plain (no settings) and of one kind, and then maps them one for one (a client sends a copy
    down each connection, so two connections stay two). An existing gateway is offered only when its one route out
    is a plain route to this service, of the same kind: a new route would take a share of its traffic, and a
    filtered one would drop the new callers'. Unit tests play a seeded simulation before and after every option
    and assert each node (gateways aside) handles the same messages.
  - Edit ops once resolved an id to a node before a connection, and a file could use one id for both, so a fix
    that removed a connection by id could delete an unrelated service and its connections. Batch 3 withheld those
    fixes (`ctx.edgeRef`). The root cause is fixed since: ids are unique across nodes, connections, boundaries and
    notes (`validateDiagram` renames the connection when a file comes in), and edit ops act on the kind their
    target is. The fixes are offered again; regression tests open such a file and check the fix acts on the
    connection only.
  - `shared-database`'s request to the owner keeps each replaced flow's settings (a keyed connect, then its props).
  - `single-point` sizes a busy node with capacity planning's own `redundancyFix` (`src/sim/capacityPlanning.ts`),
    bounded by the props schema's 10,000 (`MAX_COUNT`, shared with the capacity fix). When no count within the
    bound is enough, it still offers two replicas and says capacity needs more than replicas.
  - `sync-chain` picks each last hop's winning start before building any path, and `entry-gateway` no longer scans a
    service's callers per caller: both were quadratic (many starts into one shared chain, many clients into one
    service), and the scaling test now covers both shapes.
  - Agents: an alternative is listed in `fix.others` only with its ops; one too long for the reply is named in
    `fix.elsewhere` for the person to pick in the Checks card.
  - Keyboard: a fix (button or chip) applied from a focused row moves focus to the next finding's head (else the one
    before, else the card's Close; in the inspector, its body), not to the page.
- **Done since.** The Kubernetes and docker-compose imports wrote `replicas` only when it was more than one, so an
  imported one-replica Deployment read as "not said" and `single-point` stayed quiet on it, though it's exactly
  kube-linter's `minimum-three-replicas` case. The import follow-ups write a stated `replicas: 1` (see "Imports"
  under "Batch 3: precision gate").

## Batch 4: as built

`secret-identity` and `schema-registry`, through the engine and the UI that batches 1 to 3 built. What was decided
while building:

- **Order.** `CHECK_RULES` gains `secret-identity` and `schema-registry` after `single-point`, as in the rule table.
  Both raise one finding per diagram: the fix serves every service or topic at once, so one row per service would
  offer the same fix several times, and applying one would clear the rest.
- **Edit ops can draw a dependency.** `connect` takes an optional `relation` (`secret`, `identity`, `config`,
  `telemetry`, `deploy` or `depends`; left out, it's a flow as before), in the operation schema, `ops.v1.json` and one
  line of `applyOps`. Before this, an op could only draw a flow, and a flow into an identity or a registry takes a
  copy of every message the service sends. Agents can now draw dependencies too ("the API reads secrets from Key
  Vault"). The connection's ends resolve to nodes or shapes only, as every `connect` does since ids became unique
  (#71).
- **No traffic changes.** Both fixes only add a node and dependencies. The seeded-simulation helper batch 3 wrote for
  `entry-gateway` is shared now (`src/test/delivery.ts`), and it also asserts that a node a fix adds handles nothing:
  without that, a fix that drew flows would still pass, since a copy down a new route reaches only the new node.
  Turning the new `relation` off makes both rules' traffic tests fail.
- **Only what they create.** The fixes connect to existing services by id and never update or remove anything. A
  new node goes in the boundary its services (or the topics) share, and that boundary refits around its members, as
  any add into a boundary does. No id-sharing guard: ids are unique on load and ops resolve by kind (#71). The fixes
  allocate no ids themselves (`applyOps` does, for what they add); they name only batch keys. A fix is offered
  only while it fits the operation schema: at most 100 ops in the batch and ids of 200 characters or less; past that
  the row says it's too big a change for one step (unit tests as built: 60 services got the shared identity but no
  per-service chip, 120 got no fix; since the owner's decisions, 50 get one each with the shared chip, 51 get the
  shared one with the row saying why, 120 get no fix). The op count is checked before any op is built, and the boundary a new node goes in is an
  indexed lookup, so a diagram with a boundary per service doesn't read every boundary per service (a test counts
  the reads).
- **Agents.** The chip's ops go to agents as `fix.others` while they fit beside the default's ops, else named in
  `fix.elsewhere`, within the reply's 1.5K-character budget (`agentReport` as in batch 3). As built that was the
  per-service identities; since the owner's decisions the per-service ones are `fix.ops` and the shared one is
  `fix.others`.
- **The stencil.** The brief asked for a Google Cloud service account stencil; the catalogue has had one,
  `gcp.service-account`, since imports batch 3 (Kubernetes manifests). Its icon is Google Cloud's IAM icon from the
  Iconify `gcp` set (`gcp:identity-and-access-management`, Apache-2.0, listed in `docs/ICONS.md`), like every GCP
  icon here. Nothing was added; a unit test pins it as what Google Cloud services get, with its icon and its Identity
  relation.
- **The AsyncAPI import.** It already wrote `props.contentType` on a channel (imports batch 2) from a message's
  content type, its schema format or its payload's, and it adds a registry itself when it sees Avro or Protobuf on
  Kafka. New tests cover Protobuf by content type, Avro by the payload's schema format, JSON (no `contentType`), and the
  round trip: the import's registry keeps the check quiet, and with it taken out, the check warns from `contentType`
  alone and its fix clears it.
- **Performance.** Both rules are one pass over the edges and nodes. `src/checks/examples.test.ts` times them on 375
  and 1,500 nodes and asserts the ratio stays under 8, on a context built beforehand (the shared context is linear and
  would hide a rule's own cost), once on a mixed diagram and once per rule on a diagram made mostly of what it reads.
  Two deliberately quadratic mutations fail it, then were reverted: a scan of every edge per service for an identity
  (ratio about 12.5) and a scan of every compiled edge per topic for producers (about 12).
- **What ships when.** Startup JavaScript: unchanged (within a few bytes gzip). The checks worker +2.4 kB gzip, the
  main-thread fallback chunk +2.1 kB, the ops chunk +0.1 kB (the `relation` field). `stencils/relations`, which the
  rules now share with the canvas, moved from the canvas chunk into the canvas's shared chunk (+0.4 kB there, −0.4 kB
  in the canvas). The entry is 110.4 kB of its 123.5 kB budget.
- **Not done.** Event Hubs with Avro (Azure Schema Registry is part of Event Hubs, and the catalogue has no stencil
  for it). Vault's Kubernetes auth as a drawn identity: the catalogue has no Kubernetes service account stencil, which
  is why Vault on no cloud stays quiet.

## Batch 5: as built

**Run simulations**, in the Checks card: the diagram's saved simulations play headless in a worker, their lost messages
are counted onto the findings they bear out ("24 dropped in “Payments service goes down”"), and a new rule, `dropped`,
raises losses no other check explains. Engine: `src/checks/evidence.ts` (with `rules/dropped.ts`, `evidenceMerge.ts`,
`evidenceWorker.ts` and `evidenceClient.ts`); canvas: `src/canvas/checks/simulationRuns.ts`; card:
`src/checks/ui/SimulationsBar.tsx`. What was decided while building:

- **Losses only; on purpose is a note, not a finding** (open question 3, as recommended). A saved simulation usually
  breaks or floods something to tell its story, so the run counts only messages lost: dropped (no dead-letter route, a
  request to a node that's down or fails, a message published to a broker that's down) and dead letters left unread
  in a queue `no-reader` names. Never backlog, lag or overload: on the 16 examples, 19 nodes back up past 100 messages
  in 12 of the 32 simulations, every one the story (a rush, a throttle, a rebuild, an outage's lag). A loss is **on
  purpose** when it happened while the simulation had that node down (or paused) or failing, tick by tick, from the
  setup and the timeline actions it actually played (an outage scheduled after the losses, or past the minute,
  excuses nothing), or when its own expectations count on it (`> 0`, `>= n` or `== n` with n above 0, on that node's
  dropped, backlog or lag). An expectation of none (`== 0`) makes any loss there evidence. On purpose, it's one muted
  line under the summary ("On purpose: 96 dropped at Load balancer, which “Region outage and failover” takes down",
  the node a link that selects it) and never a finding, a marker or a count.
- **Evidence never raises anything.** Counts never change a finding's severity, and `dropped` is always a Suggestion,
  so the warning count under the title never moves (still 2 across the 16 examples).
- **Counts, then what they mean.** The run keeps raw counts per simulation and node (all of a node's losses, the part
  lost on purpose and why, what its expectations say); what they mean is decided each time a check result is shown
  (`evidenceMerge.ts`), against the checks as they are then. So Turn off this check, Ignore here and turning a check
  back on agree with a fresh run without playing again. The rules, in order: a loss the expectations count on is
  planned, whatever finding is there; at a node that isn't a broker, a `single-point` finding takes the whole loss
  (what one replica costs, outage included); otherwise the part lost on purpose is planned, and the rest is the
  design's: at a broker on its `dead-letter` finding (nothing when that check is off: `dropped` would bring back what
  was turned off), anywhere else, or at a broker without that finding, `dropped:{node}`. At a broker it's "Messages
  are lost at {node}", with the consumers that failed there as its chips; elsewhere, "Failed requests to {node} are
  lost". As built, the broker's finding had dead-letter's fix ("Add dead-letter queue"); since the owner's decisions
  neither has a fix (see "Owner's decisions (2026-10-13)"). Dead letters left unread go on `no-reader`. Ignored findings get counts too,
  for when Show again brings them back.
- **Bounded.** At most 60 s of simulated time per simulation, one 10 ms engine tick at a time; a pausing note is
  resumed at once. Before a simulation is built, its **start work** (the sampled messages its traffic and timeline
  inject, times the most routes any node sends a copy down) must be under 10 million: a file at the format's limits
  with an ordinary fan-out is far under it, a burst of 100,000 into 20,000 routes (two billion copies in a tick) isn't
  played ("“…” starts too much traffic to play here: not counted"). At most 15 s of wall-clock time for the whole run,
  read before each simulation, after building it, every 100 ticks and when it ends: one the budget cuts short or that
  ends after it is left out whole, and the card says so ("Out of time before “Rush 3”: not counted"). The client also
  terminates a worker that outlasts its budget by 5 s, for a tick that never ends. A simulation stopped at the minute
  says so on its counts ("in the first minute of …"). Tests count ticks and slices and drive the budget with a clock of
  their own.
- **Deterministic.** Each simulation plays from its own seed, a tick at a time, so the same diagram gives the same
  counts however the work is sliced (a unit test plays one diagram whole, a tick at a time and seven at a time, and
  compares). The wall-clock budget only decides which simulations are counted, and says so.
- **Cancellable, at once.** One run at a time, in a worker of its own that's terminated to stop it. Stop (the same
  link, which keeps focus from Run simulations to Stop to Run again, at one place in the card whether or not there
  are findings), **Esc** (one level: it stops the run, the next Esc closes the card), closing the card, leaving editing
  (live view, presenting) and any edit a simulation would see each stop it. What a simulation sees is projected from
  the canvas: each node's id, stencil, label and subtitle (a label names a node's messages and marks a dead-letter
  queue) and props, each connection's ends, kind, relationship and props, and the simulations. Moving a node (even
  out of a boundary), changing an attachment side or selecting things doesn't stop a run or hide its counts. Values
  are compared by reference first and by content only when a reference changed, without copying anything per change.
- **Stale with the diagram; never in the file.** The counts are worked out again, the same, from the file in seconds,
  they'd be wrong after any edit, and they'd leak into share links and exports, so they live in memory only, for the
  open diagram (closing and reopening the card keeps them). An edit a simulation would see hides them at once ("The
  diagram changed since the simulations played. Run again"); Undo back to what they were played on shows them again.
- **Off the main thread.** The main thread posts the file and receives one progress message per simulation and the
  result. A progress message updates only the line: nothing is merged or indexed again. Where workers fail, it plays
  here, a tick at a time with the clock read between ticks, so a slice ends within a tick of its 6 ms; but only a
  diagram of up to 300 nodes, whose preparation (the checks and the topology, which can't be sliced) is short, and
  only simulations under a fiftieth of the start-work bound. Larger ones say the browser can't play them in the
  background. The e2e test types in a finding's Ignore box (an edit would stop the run) over a 1,500-node diagram,
  alternating idle and playing three times each, as the checks' own typing test does. It found one thing: a spinner
  in the card, whose blurred background made the browser repaint the canvas behind it every frame (a median keystroke
  three times the idle one). The card has no spinner; "Playing 2 of 5: “…”…" says it.
- **Surfaces.** The card exists only while editing, so live view, presenting, embeds, read-only views and the exported
  HTML viewer have no Run simulations; the viewer template stubs the checks store with the run's two methods. (Since
  the owner's decisions, Ctrl+K and the canvas right-click run them too, with the same rules.) The
  self-hosting switches don't touch it (it's local, like the checks), and `pnpm build:internal` builds it.
- **Agents.** `check_diagram` takes `simulations: true` (off by default): the same worker and bounds, the counts as
  short lines on each finding (`evidence`, at most three) and one `simulations` line saying what played and what was
  lost on purpose, within the reply's 1.5K characters. It costs seconds on a large diagram, which is why it's opt-in.
  Before anything goes back, everything checked at the start is checked again: the same diagram in the same editor
  (and the same document in it), AI tools still allowed for it (not made Private or local-only, and the copy still
  has them), and the call not cancelled; the call's abort signal stops the playback. If anything changed, the reply
  says nothing about the diagram (as Copy link with password does since #70).
- **What ships when.** Startup JavaScript: 22 bytes smaller gzip (the entry −28, the model's rule list +6). The canvas
  chunk +1.2 kB gzip (the run controller), the card +1.0 kB and 0.15 kB of CSS, the static engine +0.6 kB (the new
  rule's words), `check_diagram`'s report +0.3 kB. On the first click: the client (1.2 kB) and the merge (0.4 kB), then
  the worker (35.5 kB: the simulation engine and the checks). The main-thread fallback shares the simulation runner
  with the trace card, which moved it into a chunk of its own (9 kB, out of the trace card's 14 kB).
- **Performance.** The 32 saved simulations of the 16 examples play in about 0.3 s in all (10 to 31 ms an example, in Node).
  The e2e fixture, 1,500 nodes whose messages go round a loop for the whole minute, takes the production build's
  worker about 3.2 s a simulation (9.5 to 9.9 s for three, the same counts each time).

**The table.** Every count and finding Run simulations raises on the 16 public examples (top level only), as planned
(every loss a finding or a count, backlog as evidence) and as built. `src/checks/examples.test.ts` pins the built
evidence (no count, no finding, the two notes), so a change to it is a change to this table.

| #   | Example                       | Simulation                    | As planned                                                                     | As built                  | Verdict          | Why                                                                                                                                                                                                |
| --- | ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------ | ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | multi-region-active-active    | Region outage and failover    | `dropped:alb-us`: 96 dropped at us-east-1's Load balancer                      | A note: on purpose (down) | Noise as finding | The simulation takes the load balancer down to show the error blip before Route 53 fails over, and its expectation "A short error blip before failover" counts on it.                              |
| 2   | azure-service-bus-integration | Poison invoices               | On `no-reader:dlq`: 30 left unread in invoice.commands DLQ                     | A note: on purpose        | Noise as count   | Its expectation "All 30 poison invoices are retained" is the story (quarantine for operator replay); batch 1 judged the finding itself wouldn't-fix for the same reason.                           |
| 3   | iot-telemetry                 | Event Hubs partition hot spot | On `capacity:hot`: a backlog of 172 at Event Hubs                              | Not counted               | Noise            | It sets 64 replicas to show that partitions, not replicas, are the limit: overload on purpose, under a setup the finding (free play) doesn't share.                                                |
| 4   | 10 more examples              | 11 more simulations           | 18 more backlogs over 100, up to 1,865 at the statement projection (a rebuild) | Not counted               | Noise            | Each is what its simulation is for: Black Friday, a throttle, a rebuild, an autoscaling lag, a bulk sync, an outage's lag. Live's heat map shows them as they play.                                |
| –   | azure-service-bus-integration | Poison invoices               | Nothing on `dead-letter:posting-sub` (Warning)                                 | Nothing                   | Right            | The ledger worker fails every message, but this simulation sends only high-value invoices, through approval: none reach ledger-posting. No count isn't counter-evidence; the Warning stands alone. |

As planned: 21 items, none worth showing. As built: no count and no `dropped` finding on the examples, and two notes,
both right. The examples' simulations each tell a story on a diagram that already handles its failures, so a quiet
result is the right one. It isn't quiet where something is lost: each row below is a public example with one change a
reviewer meets in real diagrams (`src/checks/evidence.test.ts` covers each shape).

| Variant (one change)                                                  | What Run simulations shows                                                                                       | Verdict    | Why                                                                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| kafka-order-pipeline, Payments retries in place (1 s backoff)         | `dropped:order-events`: 24 dropped in “Payments service goes down”, chips orders.created.v1 and Payments service | Would fix  | The static checks are rightly quiet (a consumer that's down leaves its messages on the topic), but blocking retries use up the in-flight deliveries' attempts while it's down. A DLT keeps them. |
| azure-service-bus-integration without invoice.commands' DLQ           | On `dead-letter:commands` (Warning): 30 dropped in “Poison invoices”                                             | Would fix  | It puts a number on the warning: the whole poison batch.                                                                                                                                         |
| multi-region-active-active, us-east-1's API failing 2% of writes      | `dropped:api-us`: 4 in “Region outage and failover”, 30 in “Both regions take writes”                            | Would look | Nothing in the design retries a failed checkout. Real clients often do; as a Suggestion it asks the question, and Ignore here answers it.                                                        |
| aws-fanout with a simulation where the archive Lambda rejects 1 in 10 | `dead-letter:archive-q` becomes a Warning (static); no count                                                     | Right      | None of 300 orders failed three deliveries in a row: no loss to count, and the Warning stands on its failure rate.                                                                               |

## Simulation truths: precision gate (2026-10-13)

Items 1–6 of `docs/research/sim-flows-review.md` changed playback, not the analysis: a broker-fed consumer now takes
its slot when a delivery arrives (so travel time no longer caps it), and the default travel time is 300 / 200 ms. The
`capacity` check reads the analysis, so its findings could only move where playback and the plan had disagreed. I ran
`runChecks` on the 16 public examples (top level only) on `origin/master` and on this branch, and played each one's
free play for 60 s (seed 1, the live view's automatic scale) to see whether a backlog really only grows.

| Example                    | `capacity` finding, before → after           | Playback, before                                     | Playback, after           | Verdict                                                                                                                      |
| -------------------------- | -------------------------------------------- | ---------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| iot-telemetry              | Warning: Device state projector, 234% (same) | hub lag 28k → 62k in 30 s                            | hub lag 34k → 69k in 30 s | **Would fix**, as before: the backlog only grows, as the finding says. Precise.                                              |
| gcp-streaming-analytics    | none (same)                                  | Pub/Sub lag 108 → 219 in 30 s under "Healthy" at 13% | lag 0                     | **Now agrees.** Before, the check (and the banner) were right about capacity and playback was wrong; the engine was the bug. |
| event-driven-data-platform | none (same)                                  | segments topic lag 9 → 4 (jitter, draining)          | lag 0                     | No finding either way; the noise is gone.                                                                                    |
| the other 13               | none (same)                                  | no lag                                               | no lag                    | No finding, nothing to find.                                                                                                 |

**Numbers.** One `capacity` finding before and after (iot-telemetry), would-fix 1 of 1: precision stays 100%, and the
findings are byte-for-byte the same (`src/checks/examples.test.ts` pins them). What changed is recall against
playback: the one example where the animation contradicted a clean check (GCP) now agrees with it. The wording change
for a node saved down ("Fulfilment worker is down", no replica fix) fires on none of the examples (none is saved down);
`src/checks/capacityDown.test.ts` covers it.

**The live twin.** The callout's new "falling behind" signal (`src/live/observedTrouble.ts`) was checked the same way,
over free play and both saved simulations of each example: in free play it fires only on iot-telemetry's hub (true,
and the plan says over capacity too); in saved stories only where the lag is the story (aws-fanout "throttle",
cqrs-event-sourcing "rebuild", kafka-order-pipeline "payments-outage", with Payments down). Dead-letter queues filling
during an outage fired at first (three stories); they're left out now, since keeping what they get is their job.

## Owner's decisions (2026-10-13)

The owner reviewed batches 4 and 5. Four decisions, applied in one change (UX review: `docs/DESIGN-REVIEW.md`, round
28):

1. **`secret-identity`: one identity per service by default.** Least privilege: a service signs in only to what it
   reads. The button gives each service its own ("Add managed identities", IAM roles or service accounts, each
   named for its service; one service: "Add a managed identity"), each in its service's boundary. The plural keeps
   the button on one line in the 290 px card; the first try, "Add a managed identity for each service", widened the
   row past the card (see round 28). The chip shares one: **One shared identity**
   ("Add one shared managed identity"), or with services on two clouds **One shared per cloud**. The chip shows only
   where sharing differs, that is when a cloud has more than one service.
   - **The op budget.** One each is two ops per service; shared is one per cloud plus one per service. Up to 50
     services, one each fits the 100-op batch, with the chip. Past that, while shared still fits (up to 99 services
     on one cloud), the button falls back to the shared identity and the row says why: "One for each service is too
     big a change for one step (an edit batch), so the fix adds one they share." Past both, no fix, as before. That
     was the simplest honest behaviour: the button always does what it says, and the row explains the one case
     where it isn't the default.
   - **Agents.** The per-service ops are `fix.ops`; the shared one is `fix.others` (or `fix.elsewhere` when it
     doesn't fit the reply).
   - **No traffic changes.** The seeded-simulation test plays both the button and the chip and finds every node
     handling what it did, and the new identities nothing.
2. **Run simulations never offers fixes.** "I see this as a tool that runs these simulations… offering fixes I think
   is kind of confusing." The `dropped` findings it raises say what happened and where (the row, its count, and the
   things involved as chips that select them), with no fix button, no fix chips and no `fix` in `check_diagram`'s
   reply. That's both "Messages are lost at {node}" (which had dead-letter's fix) and "Failed requests to {node} are
   lost" (which had none). The static rules keep their fixes, and a count on a static finding (dead-letter's, say)
   leaves its fix as the check worked it out. `applyFix` no longer has a path for `dropped`, and the tool's
   description tells agents those findings never carry a fix.
3. **Run simulations from more places.** Ctrl+K and the canvas right-click (after Check diagram) have **Run
   simulations**, under the card's rules: only while editing a diagram with saved simulations (never live view,
   presenting, embeds, read-only views or the exported HTML viewer), it opens the Checks card if it's closed, then
   plays; while they play the same row is **Stop simulations**. The View menu's Checks is a toggle among toggles, the
   count under the title only opens the card, and the inspector's row only says what it found, so none of them got
   it. With it the canvas menu is 11 rows of its 12 (the AI panel, Diagram properties and Export ▸ joined it since
   batch 2), and only on a diagram with saved simulations. The actions reach the run controller through a tiny
   module (`src/canvas/checks/editingRuns.ts`) that `useChecks` sets while checks apply, so the HTML viewer (which
   bundles the actions with the checks stubbed) gains nothing. Startup JavaScript: unchanged (1 byte smaller gzip);
   the canvas chunk +155 B, the checks worker +147 B (the identity rule), the card 47 B smaller (no `dropped` fix
   path). The self-hosting switches don't touch it (it's local), and `pnpm build:internal` builds it.
   - **After code review (PR #82).** The first version was one row that toggled, deciding at the click: a menu or
     Ctrl+K left open while a run ended showed **Stop simulations** and, clicked, started a new run. Run and Stop are
     now two actions (`canvas.run-simulations`, `canvas.stop-simulations`), shown one at a time, each keeping the
     intent it was shown with: a late Stop stops nothing, a late Run doesn't restart one playing. An e2e test starts a
     run from Ctrl+K and stops it by going live, by another view and by opening another diagram, then checks Run
     simulations plays the canvas shown (it fails if the first canvas's runs stay registered).
4. **`entry-gateway`'s gap: decided, no change.** It stays quiet when the diagram draws no gateway at all. In the
   batch 3 gate, 3 of the 4 such hits were diagrams leaving the gateway out on purpose. **Owner's call (2026-10-13):
   keep it quiet; precision over recall.**

## Network devices (2026-10-13)

On-prem routers, switches, firewalls and ADCs (`docs/research/network-infrastructure.md`) meet four rules:

- **single-point**: devices count as self-hosted gateways (their replicas are units). A device fires when the diagram
  says it's one unit (`ha: "standalone"` or `replicas: 1`) or when it's 80% busy, and its fix is **Make it an HA pair**
  (`ha: "active-standby"`, `replicas: 2`). A pair or a cluster never fires.
- **capacity**: a device's capacity is its datasheet ceiling. Over 100% at the diagram's own rates, the fix is the
  smallest bigger size that lands it under 55%, or none when no size would.
- **dropped (Run simulations)** and **dead-letter**: a deny rule's work is `blocked`, never `dropped`, so neither ever
  calls it a loss.
- **sync-chain**: counts requests between services only, so network hops never deepen a chain.

**Precision gate.** The new public example, Branch office to data centre, raises nothing, and Run simulations counts no
loss in either of its simulations (`src/checks/examples.test.ts`, now 17 examples). In the data centre every device on
the only path is a pair or a cluster. The branch router is one box on the branch's only path, but the diagram doesn't
say how many units it has and it's 2% busy, so single-point stays quiet: batch 3's gate made an unset count no
evidence. That's a judgment call a branch often makes on purpose (one router and an LTE backup). The one deny rule
blocks on purpose. Rule-level cases are in `src/checks/netDevices.test.ts`.

## Explicitly not doing

- **Style and completeness lint** (missing descriptions, unlabelled edges, orphan nodes, naming conventions).
  That's Structurizr's lane. It's noisy on sketches, and the layout overlap audit already covers how things look.
- **Errors, or blocking anything.** No check stops a save, a share or going live.
- **User-written rules or a rule DSL** (Spectral-style rulesets, OPA). There are too few users who'd write them,
  and they'd need a sandbox: no `eval` under our CSP.
- **Per-rule severity settings.** On or off per diagram is enough. A severity dropdown is chrome for a handful of
  people.
- **Running checks automatically in live view or presentation.**
- **Cloud-account or IaC scanning** (Trusted Advisor, Checkov). We check designs, not deployments.
- **AI-generated findings.** Checks are deterministic rules. An agent can call `check_diagram` and explain it.
- **A baseline file** (ESLint suppressions, ArchUnit's freezing). Ignores in the diagram cover it at this scale.

## Risks

- **Noise erodes trust.** Mitigations: the evidence pass above, the would-fix review before each rule ships, Warning
  only with evidence, aggregation, and Turn off in one click. If a rule's "Ignore" rate looks high in use, demote
  it. We have no telemetry, so this rests on the owner's own use and on issues people file.
- **Fixes that surprise.** A fix adds or changes design. Mitigations: the button names the change, it's one undo
  step, the toast says what changed, and nothing is ever applied without a click.
- **Rules drifting from the simulation.** Mitigation: they share `compileTopology`, `isDlqEdge`, `deadLetterRoutes`,
  `analyzeCapacity` and `capacityPlanning`. Unit tests (`src/checks/fixes.test.ts`) assert that `dead-letter` warns
  exactly when a seeded run drops messages: no route, retry in place, a consumer-side route, a filter that takes
  nothing (all lose messages and warn), the fix and a consumer that goes down (no loss, no warning).
- **Boundary meaning is ambiguous** (network vs ownership). `shared-database` only fires when the store's boundary
  holds its owner. A future "Boundary kind" field could sharpen it; not proposed now.
- **Performance on big diagrams.** Linear rules, idle-time runs, and on-open-only above 1,500 nodes. Measured in
  batch 1: well under 50 ms for 1,500 nodes. The exception is `capacity` on a diagram with a feedback loop of flows:
  the fixed point runs to its 256-iteration bound, about 0.3 s at 1,500 nodes. Batch 2 should run checks in idle
  time (or a worker) for that reason.

## Open questions (with recommended defaults)

1. **Show the warning count all the time, or only after the first Check diagram?** _Default: always, warnings only._
   It's one muted line that's absent when there's nothing to say. Suggestions never show uninvited.
2. **`entry-gateway`: Warning or Suggestion?** _Default: Suggestion._ It fires on 4 examples that leave the gateway
   out on purpose. Revisit if the owner adds gateways to those examples. (Batch 3: it now fires only on a client
   that goes around a way in the diagram draws, so it raises nothing on the examples. A bypass is a stronger signal;
   a Warning is the owner's call once it has fired in real use.) A diagram that draws no gateway at all stays quiet:
   owner's call (2026-10-13), keep it quiet; precision over recall.
3. **Which traffic does `capacity` use when a diagram has saved simulations?** _Default: free-play rates only._
   Saved simulations often overload on purpose. Live's heat map covers them, and batch 5 adds them on demand.
   (Batch 5, as recommended: Run simulations counts only lost messages, never backlog or overload, and a loss a
   simulation causes on purpose is a note, not a finding. See "Batch 5: as built".)
4. **Where do ignores live: in the file, or in this browser?** _Default: in the file (`checks`)._ A team sees the
   same findings, and a reason travels with the diagram.
5. **Should agents be able to ignore findings?** _Default: no._ Only people can ignore or turn off checks.

[swe-20]: https://abseil.io/resources/swe-book/html/ch20.html "Software Engineering at Google, ch. 20: effective false positives under 10%, developers ignore warnings, automatic fixes"
[johnson]: https://cs.gmu.edu/~johnsonb/docs/icse2013.pdf "Johnson et al., ICSE 2013: why don't developers use static analysis tools"
[sz-insp]: https://docs.structurizr.com/workspaces/inspections "Structurizr inspections: ids, severities, property overrides"
[ip-acc]: https://docs.icepanel.io/features/accuracy-score "IcePanel inaccuracy score"
[aws-wa]: https://docs.aws.amazon.com/wellarchitected/latest/userguide/definitions.html "AWS Well-Architected Tool: HRI and MRI"
[aws-ta]: https://docs.aws.amazon.com/awssupport/latest/user/get-started-with-aws-trusted-advisor.html "AWS Trusted Advisor statuses and recommended actions"
[az-adv]: https://learn.microsoft.com/en-us/azure/advisor/advisor-overview "Azure Advisor"
[az-qf]: https://learn.microsoft.com/en-us/azure/advisor/advisor-quick-fix "Azure Advisor Quick Fix"
[gcp-rec]: https://docs.cloud.google.com/recommender/docs/key-concepts "Google Cloud Recommender: priority, impact, states"
[cc-sec]: https://docs.datadoghq.com/datadog_cloudcraft/overlays/security/ "Cloudcraft security overlay"
[camunda]: https://docs.camunda.io/docs/components/modeler/web-modeler/fix-problems-in-your-diagram/ "Camunda Web Modeler: fix problems in your diagram"
[sparx]: https://sparxsystems.com/enterprise_architect_user_guide/17.2/model_validation_3.html "Sparx EA model validation"
[capella]: https://forum.mbse-capella.org/t/validate-diagram-button/3872 "Capella: validate diagram"
[lucid]: https://community.lucid.co/product-questions-3/validating-bpmn-2-0-flows-on-method-and-style-11943 "Lucid community: no automatic BPMN validation"
[eslint-rules]: https://eslint.org/docs/latest/use/configure/rules "ESLint rule severities and disable comments"
[eslint-custom]: https://eslint.org/docs/latest/extend/custom-rules "ESLint fixes vs suggestions"
[polaris]: https://polaris.docs.fairwinds.com/checks/reliability/ "Polaris reliability checks: deploymentMissingReplicas"
[kubelinter]: https://raw.githubusercontent.com/stackrox/kube-linter/main/docs/generated/checks.md "kube-linter checks: minimum-three-replicas"
[spectral]: https://raw.githubusercontent.com/stoplightio/spectral/develop/docs/guides/4-custom-rulesets.md "Spectral rulesets"
[sqs-dlq]: https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html "Amazon SQS dead-letter queues"
[sb-dlq]: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues "Service Bus dead-letter queues"
[cf-err]: https://www.confluent.io/blog/error-handling-patterns-in-kafka/ "Confluent: error handling patterns in Kafka"
[spring-rt]: https://docs.spring.io/spring-kafka/reference/retrytopic/how-the-pattern-works.html "Spring Kafka retry topics and DLT"
[distmono]: https://archman.dev/docs/anti-patterns-and-pitfalls/distributed-monolith "Distributed monolith (secondary source)"
[selfcontained]: https://microservices.io/patterns/decomposition/self-contained-service.html "Self-contained service: availability of synchronous collaboration"
[aws-avail]: https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/availability.html "AWS reliability pillar: availability with hard dependencies and redundancy"
[az-chains]: https://learn.microsoft.com/en-us/azure/architecture/microservices/design/interservice-communication "Azure: interservice communication"
[dbps]: https://microservices.io/patterns/data/database-per-service.html "Database per service"
[az-net]: https://learn.microsoft.com/en-us/azure/well-architected/security/networking "Azure WAF: networking"
[aws-waf]: https://docs.aws.amazon.com/wellarchitected/2025-02-25/framework/sec_network_protection_inspection.html "AWS SEC05-BP03"
[az-secrets]: https://learn.microsoft.com/en-us/azure/well-architected/security/application-secrets "Azure WAF: application secrets"
[aws-sec02]: https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_identities_unique.html "AWS SEC02-BP02"
[cf-avro]: https://docs.confluent.io/platform/current/schema-registry/fundamentals/serdes-develop/serdes-avro.html "Confluent Avro serializer wire format"
[cf-sr]: https://docs.confluent.io/platform/current/schema-registry/index.html "Confluent Schema Registry"
