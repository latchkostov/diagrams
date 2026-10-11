# Diagrams

**[livediagrams.dev](https://www.livediagrams.dev)**

Architecture diagrams for event-driven systems, with a **live view** that plays messages through them.

Draw your system with modern stencils (Kafka, Azure Service Bus, Event Hubs, SQS/SNS, Pub/Sub, Flink,
Postgres, Redis, Snowflake, dbt, Stripe, and about 160 more), then go live: inject a storm of events and watch
them fan out through topics, see a consumer fall behind when it goes down, and see poison messages land in a
dead-letter queue. Save simulations with the diagram and replay them, narrated, in a meeting. Everything runs
in the browser. There is no account and no server.

## Features

- **Diagram editor.** Stencils grouped by vendor family, search with aliases ("sb", "pg", "msk"), right-click
  menus everywhere, an inspector, undo/redo, keyboard shortcuts, a Ctrl+K command palette, and orthogonal
  edge routing that keeps labels off nodes. Text, notes, zones and shapes for annotating.
- **Live view.** Messages animate along the real edges. Topics fan out per consumer group, queues load-balance
  across consumers, and failures retry and then dead-letter. Each node shows a live metric badge.
- **Simulations.** Traffic shapes borrowed from load testing (burst, constant, ramp, spike), a chaos timeline,
  narration notes, and expectations that pass or fail live. Simulations are saved in the diagram file.
- **Inputs and capacity.** Rates in real units ("2,000 orders/s"), replicas, partitions, and Traffic × and
  Capacity × what-ifs. A bottleneck heat map suggests a fix you can apply in one click.
- **Examples.** Fifteen narrated examples grouped by theme: event streaming (Kafka, CQRS and event sourcing,
  CDC, IoT), data and AI (an event-driven Snowflake platform with reverse ETL, nightly batch ELT, GCP streaming
  analytics, a RAG assistant), cloud serverless, integration (webhooks, notifications, Service Bus) and
  reliability (outbox and saga, multi-region active/active). Each has two saved simulations.
- **Sharing.** Your diagrams are stored locally. Export to PNG, SVG, draw.io and Mermaid, and import draw.io and
  Mermaid. Share links carry the whole diagram in the URL, an embed mode makes a read-only viewer, and Record
  saves a simulation as a video. Google Drive works once it's configured (see `docs/INTEROP.md`).

## Development

```sh
pnpm install
pnpm dev            # http://localhost:5173
pnpm check          # typecheck, lint, unit tests (Vitest), e2e tests (Playwright)
pnpm build          # production build in dist/
pnpm review         # multi-angle Codex review of changes since review-base
```

The Lab (`?view=lab`) renders the current components with presets: node and edge states, stress diagrams, overlap
audits, simulation scenarios and capacity states. Use it to preview changes quickly.

## Docs

| Doc                     | What's in it                                                                     |
| ----------------------- | -------------------------------------------------------------------------------- |
| `docs/PLAN.md`          | Goals, phases, and layout conventions                                            |
| `docs/UX-PRINCIPLES.md` | The design bar and vocabulary; every feature batch passes a UX review against it |
| `docs/SIMULATION.md`    | Engine semantics: roles, consumer groups, retries, DLQ, capacity, units          |
| `docs/SIMULATIONS.md`   | The saved-simulation format: traffic, timeline, expectations                     |
| `docs/INTEROP.md`       | Formats, share links, embed, and Google Drive setup                              |
| `docs/ICONS.md`         | Icon sources and licences                                                        |
| `docs/QUALITY.md`       | The quality loop: checks, Codex reviews, and UX gates                            |
| `docs/DESIGN-REVIEW.md` | UX review rounds and scorecards                                                  |
| `docs/BACKLOG.md`       | Known follow-ups                                                                 |

## License

MIT. See `LICENSE`. Icons keep their own licences (below).

## Icons and trademarks

Product logos and service icons are trademarks of their owners and are used to identify those products in
architecture diagrams. Sources and licences are listed in `docs/ICONS.md`.
