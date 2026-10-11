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

| Area                                                                | Owner                      |
| ------------------------------------------------------------------- | -------------------------- |
| `src/model/**`, `src/stencils/registry.ts`, configs                 | lead (ask before changing) |
| `src/stencils/catalog.ts`, `src/stencils/icons/**`, `docs/ICONS.md` | stencils agent             |
| `src/examples/**`                                                   | examples agent (Codex)     |
| everything else in `src/`, `index.html`, `public/`                  | app agent                  |

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

- Node cards are 220–260 × 72 px (long labels truncate with a tooltip). Use a column grid: x = 40 + col*380, y = 40 + row*120 (LR flow). Edges are routed around cards automatically; leave label room between columns.
- Groups (cloud / cluster boundaries) are drawn behind nodes; give them ~40px padding around their nodes.
- Edge direction = direction messages/requests travel.

## Examples contract

`src/examples/index.ts` exports `interface Example { slug: string; diagram: DiagramFile }` and
`examples: Example[]`. Each diagram lives in its own `src/examples/<slug>.json` (a valid `DiagramFile`)
imported by `index.ts`.

---

# Phase 2: productionize + live view (started 2026-10-10)

Goal: a production-quality, free, open tool. Custom right-click menus everywhere, inspector,
undo/redo, smarter edge routing, the **live simulation**, a **Lab** harness that previews the
current components with presets, unit + e2e tests, and a build that embeds in latchkostov.com.

## Workstreams & file ownership (parallel — stay in your lane)

| Workstream         | Owns                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Sim engine (Codex) | `src/sim/**` except `types.ts` (contract — propose changes, don't make them)                                       |
| Editor UX          | `src/canvas/**`, `src/components/**` except `TopBar.tsx`, `src/styles/canvas.css`, new `src/editor/**`             |
| Test infra + Lab   | `src/App.tsx`, `src/components/TopBar.tsx`, `src/lab/**`, `src/styles/lab.css`, `tests/**`, `playwright.config.ts` |
| Lead               | `src/model/**`, `src/sim/types.ts`, `package.json`, configs, `docs/PLAN.md`, `docs/SIMULATION.md`                  |

Rules: never edit outside your lane (ask the lead in your final report instead). Don't commit —
the lead commits between phases. `pnpm exec tsc --noEmit` errors in other lanes' files are not yours.
All interactive elements get `data-testid`. Tests: `pnpm test` (vitest, `src/**/*.test.ts`),
`pnpm test:e2e` (Playwright, `tests/e2e/**`).

## Phase 3 lanes (started 2026-10-11)

| Workstream                                                                                            | Owns                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sim runner + typed routing (Codex, in progress)                                                       | `src/sim/**` except `types.ts`, `src/examples/**/*.json`, `src/lab/scenario*.ts`                                                                                                                          |
| Live view UI                                                                                          | `src/live/**`, `src/styles/live.css`; surgical integration edits in `src/canvas/CanvasView.tsx`                                                                                                           |
| Import / export / storage                                                                             | `src/interop/**`, `src/styles/interop.css`, `src/lib/diagramIO.ts`, `src/components/TopBar.tsx`, `src/App.tsx`, `docs/INTEROP.md`, `.env.example`; surgical edits in `CanvasView.tsx` for read-only/embed |
| Design review                                                                                         | `src/gallery/**`, `src/styles/gallery.css`, `src/canvas/Palette.tsx`, `src/styles/tokens.css`, `src/styles/app.css`, `docs/DESIGN-REVIEW.md`; palette rules in `canvas.css`                               |
| Shared-file rule: `CanvasView.tsx` and `canvas.css` may be touched by two lanes. Make small, isolated |
| edits, re-read before editing, and never reformat or reorder code you didn't write.                   |

## Phase 4 (queued): Inputs & capacity (real-world what-if)

Owner ask: "here's my architecture, here's how many Kafka messages per second, how many APIs…"
customizable but not too granular.

- **Real units, sampled dots:** `Simulation.scale` (1 dot = N messages). Users enter real rates; counters,
  lag and throughput display real numbers; the engine simulates rate ÷ scale. Auto-pick a scale so
  ≤ ~60 dots/s are drawn.
- **Human knobs:** rate per entry point, `replicas` per service (× concurrency), latency (+ `jitter`),
  failure %, partitions per topic. Global **Traffic ×** and **Capacity ×** sliders (`Simulation.multipliers`).
- **Kafka truth:** consumers per group beyond partitions sit idle; badge "3/6 replicas idle".
- **Bottleneck analysis (no run needed):** analytic max throughput per node
  (replicas × concurrency ÷ latency, capped by partitions; brokers by partitions × consumer rate),
  utilization = offered ÷ capacity propagated from entry rates through the graph (fan-out copies,
  queue splits, filters), heat overlay + "bottleneck" callout + suggested fix.
- **One "Inputs & capacity" panel**: auto-generated, grouped (Entry points / Services / Topics & queues),
  sliders with real units, saved into the simulation (`setup.props`, `multipliers`, `scale`).
- UX gate after.
