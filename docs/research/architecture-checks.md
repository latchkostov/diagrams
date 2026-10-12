# Architecture checks: warnings with one-click fixes

Research and plan, October 2026. Nothing here is built yet.

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
evidence ("312 messages were dropped here in _Payments goes down_") is a later, on-demand batch.

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

Next batch (both asked for, and both need a little more model first):

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
- **Detects.** A broker (queue, topic or stream) with ordinary routes to processors, no DLQ route out of it or out
  of those consumers (`compileTopology`'s `dlq` edges), and not itself a DLQ target.
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

#### 9. `secret-identity` (next): {n} services read secrets without an identity

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

#### 10. `schema-registry` (next): Avro on {topic}, but no schema registry

- **Why.** Confluent's Avro serializer writes a magic byte and a 4-byte schema id from the registry
  ([Confluent][cf-avro]). "Starting a project with Schema Registry is a best practice" ([Confluent][cf-sr]). It's
  not strictly required, so it's a Warning, not more.
- **Detects.** A Kafka-family topic whose `props.contentType` (written by the AsyncAPI import, see `imports.md`)
  or label says Avro or Protobuf, while the diagram has no `kafka.schema-registry` node. It needs that data, so it
  ships with the AsyncAPI import.
- **Fix: Add Schema Registry.** One node, with a **Depends on** dependency from each producer and consumer of those
  topics (the stencil's inferred relation).

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

The two dead-letter warnings are real. The Kafka order pipeline's "Payments service goes down" takes a consumer
down, and the Service Bus example's "Poison invoices" sets the ledger worker's failure rate to 1. In both, there's no
DLQ route, so the simulation drops the messages that run out of deliveries. The refined rules give 2 to 3 findings on
a busy example, and none on most. Before shipping, the owner should mark each refined finding on the examples as
"would fix" or "wouldn't". A rule under 90% "would fix" becomes a Suggestion or goes.

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
  iterations. Add a perf test with a 1,500-node synthetic diagram, under 50 ms (`src/test/perfBudget.ts`).

## Build batches

Each batch is its own PR and ends with the UX review gate (`docs/UX-PRINCIPLES.md` § Process; findings in
`docs/DESIGN-REVIEW.md`). They're ordered by value per effort.

1. **Engine and the four structural rules.** `src/checks/` with the shared context, plus `dead-letter`, `no-reader`,
   `sync-cycle` and `capacity`. These are the highest value with the lowest false-positive risk, and they reuse
   `compileTopology` and `analyzeCapacity` directly. Includes the regression snapshot over the examples, and
   `check_diagram` (read-only, no UI needed, so agents get value first). _Gate: the owner marks every finding on
   the examples as would or wouldn't fix._
2. **The Checks card, the count and fixes.** The card, the diagram-card count, markers while open, the node
   inspector row, the canvas right-click and Ctrl+K, and fixes for batch 1's rules as ops through `applyOps` (one
   undo step, toast with Undo). Ignore and turn off, in the file (`checks` field, validator, schema, `pnpm
schemas`). _UX gate: chrome budget, keyboard, Esc order, dark theme, 1280×800, presentation and export clean._
3. **The other four starter rules.** `sync-chain`, `shared-database`, `entry-gateway` (with stencil chips) and
   `single-point` (dominators, plus the capacity escalation), each with its fix. _Gate: the examples snapshot
   again._
4. **Rules that need more model.** `secret-identity` (aggregated, plus a GCP service account stencil) and
   `schema-registry` (with the AsyncAPI import's `contentType`, see `imports.md`).
5. **Simulation evidence (on demand).** In the Checks card, **Run simulations** plays each saved simulation
   headless in a worker (deterministic, seeded, capped at 60 s simulated time) and attaches counts to findings
   ("312 dropped in _Payments goes down_"). It also adds `dropped` findings that the static rules can't see. Only
   on click: it costs seconds.

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
- **Rules drifting from the simulation.** Mitigation: they share `compileTopology`, `isDlqEdge` and
  `analyzeCapacity`. A unit test asserts that `dead-letter`'s warning cases are exactly the cases where a seeded
  run drops messages.
- **Boundary meaning is ambiguous** (network vs ownership). `shared-database` only fires when the store's boundary
  holds its owner. A future "Boundary kind" field could sharpen it; not proposed now.
- **Performance on big diagrams.** Linear rules, idle-time runs, and on-open-only above 1,500 nodes.

## Open questions (with recommended defaults)

1. **Show the warning count all the time, or only after the first Check diagram?** _Default: always, warnings only._
   It's one muted line that's absent when there's nothing to say. Suggestions never show uninvited.
2. **`entry-gateway`: Warning or Suggestion?** _Default: Suggestion._ It fires on 4 examples that leave the gateway
   out on purpose. Revisit if the owner adds gateways to those examples.
3. **Which traffic does `capacity` use when a diagram has saved simulations?** _Default: free-play rates only._
   Saved simulations often overload on purpose. Live's heat map covers them, and batch 5 adds them on demand.
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
