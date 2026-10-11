# Diagrams — prototype plan

Goal: a draw.io-lite for modern distributed-systems diagrams (Kafka, Azure Service Bus, ...),
showcased on latchkostov.com. Beautiful by default, fast to build with, and later a **live view**
that simulates messages flowing through any saved diagram (great for meetings).

Phase 1 (now): stencil gallery + render example diagrams. No simulation yet, but the
format already carries what the sim needs (`simRole` on stencils, directed edges, `kind`, `props`).

## Contract
- `src/model/types.ts` — `DiagramFile` (saved format `diagrams/v1`), `Stencil`, `SimRole`.
- `src/stencils/registry.ts` — `stencils`, `getStencil(id)` (falls back, never throws), `iconUrl(icon)`.
- `src/stencils/catalog.ts` — the stencil list. Icons live in `src/stencils/icons/<icon>.svg`.

## File ownership (parallel work — do not edit outside your area)
| Area | Owner |
|---|---|
| `src/model/**`, `src/stencils/registry.ts`, configs | lead (ask before changing) |
| `src/stencils/catalog.ts`, `src/stencils/icons/**`, `docs/ICONS.md` | stencils agent |
| `src/examples/**` | examples agent (Codex) |
| everything else in `src/`, `index.html`, `public/` | app agent |

## Required stencil ids (examples may use exactly these)
Every id below MUST exist in the catalog. More may be added.

**messaging**
- `kafka.topic`, `kafka.cluster`, `kafka.connect`, `kafka.schema-registry`
- `azure.service-bus.queue`, `azure.service-bus.topic`, `azure.event-hubs`, `azure.event-grid`, `azure.storage-queue`
- `rabbitmq.exchange`, `rabbitmq.queue`
- `aws.sqs`, `aws.sns`, `aws.eventbridge`, `aws.kinesis`
- `gcp.pubsub`, `nats.subject`, `redis.stream`

**compute**
- `azure.functions`, `azure.app-service`, `azure.container-apps`, `azure.aks`, `azure.logic-apps`
- `aws.lambda`, `aws.ecs`
- `k8s.pod`, `k8s.deployment`, `docker.container`
- `service.dotnet`, `service.java`, `service.node`, `service.python`, `service.go` (microservice by language)

**data**
- `postgres`, `sqlserver`, `azure.sql`, `azure.cosmos-db`, `azure.blob-storage`, `mongodb`, `redis.cache`,
  `elasticsearch`, `aws.s3`, `aws.dynamodb`, `snowflake`, `databricks`

**network**
- `azure.api-management`, `azure.front-door`, `azure.app-gateway`, `aws.api-gateway`, `nginx`, `cloudflare`, `load-balancer`

**observability**
- `grafana`, `prometheus`, `datadog`, `azure.app-insights`, `opentelemetry`, `splunk`

**security**
- `azure.key-vault`, `entra-id`, `vault`

**clients**
- `client.user`, `client.browser`, `client.mobile`, `client.partner` (external system / 3rd-party API), `client.iot`

**generic**
- `generic.service`, `generic.database`, `generic.queue`, `generic.topic`, `generic.scheduler`, `generic.webhook`, `generic.email`

## Layout conventions for examples
- Node card is ~220 x 72 px. Use a column grid: x = 40 + col*360, y = 40 + row*120 (LR flow).
- Groups (cloud / cluster boundaries) are drawn behind nodes; give them ~40px padding around their nodes.
- Edge direction = direction messages/requests travel.

## Examples contract
`src/examples/index.ts` exports `interface Example { slug: string; diagram: DiagramFile }` and
`examples: Example[]`. Each diagram lives in its own `src/examples/<slug>.json` (a valid `DiagramFile`)
imported by `index.ts`.
