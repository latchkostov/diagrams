# Live Diagrams

**[livediagrams.dev](https://www.livediagrams.dev)**

Live Diagrams draws architecture diagrams for event-driven systems, with a **live view** that plays messages through them.

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
- **Examples.** Thirty-four narrated examples grouped by theme: full systems of 40 to 60 services (Black Friday
  commerce, cell-based bookings across three regions, a payments ledger, food-delivery dispatch, an EV charging
  network, recommendations with a feature store, a video-on-demand pipeline, an observability pipeline and a hybrid
  enterprise network), event streaming (Kafka, CQRS and event sourcing, CDC, autoscaling), data and AI (an event-driven Snowflake
  platform, nightly batch ELT, GCP streaming analytics, a RAG assistant), cloud apps, integration (webhooks,
  notifications, Service Bus) and reliability (outbox and saga, networks). Each has two or more saved simulations.
- **Sharing.** Your diagrams are stored locally. **File ▸ Share…** lists every way out, safest first, each saying
  who can open it: an Interactive HTML file (with a password if you like), the diagram file, an embed your own app
  supplies, a link with a password, and, one deliberate step further, a public share link or embed. Export to PNG,
  SVG, draw.io and Mermaid, import draw.io and Mermaid, and Record saves a simulation as a video. Google Drive works
  once it's configured (see `docs/INTEROP.md`).

## Use with your AI agent

The **livediagrams** [Agent Skill](skills/livediagrams/SKILL.md) lets an agent draw diagrams for you. Ask "diagram
our order pipeline" and it writes a `.diagram.json` file, checks it, and asks what you want back:

- an **interactive HTML file** (recommended for work and company diagrams): the app's Interactive HTML export, made
  offline by the skill's `export-html.mjs`. It plays the simulations, works offline, makes no network requests, and
  only people who have the file can open it (with `--password`, only those who also have the password);
- the **diagram file**, to keep editing at livediagrams.dev;
- an **image**, which it tells you how to export from the app;
- a **share link**, where anyone who has the link can open the diagram. Private diagrams never get one.

No browser is needed and nothing is uploaded. The skill needs Node.js 20 or later and no keys. To install it:

- **Claude Code**: `/plugin marketplace add latchkostov/diagrams`, then `/plugin install livediagrams@livediagrams`
  (or, on Claude Code 2.1.275 or later, `/plugin install livediagrams --marketplace latchkostov/diagrams`).
- **Claude apps** (claude.ai, desktop): download
  [livediagrams-skill.zip](https://www.livediagrams.dev/livediagrams-skill.zip) and upload it in **Settings >
  Capabilities > Skills**.
- **Codex**: unzip it into `~/.agents/skills/` (for you) or `.agents/skills/` (for one repository).
- **Other agents** that read the Agent Skills format: copy the `livediagrams/` folder into the agent's skills folder,
  such as `~/.claude/skills/` for Claude Code without the plugin.

The same steps, with copyable commands, are at [livediagrams.dev/skill/](https://www.livediagrams.dev/skill/) (linked from
the AI panel). The skill is also published at [livediagrams.dev/skill/SKILL.md](https://www.livediagrams.dev/skill/SKILL.md). Its
stencil list, validator, layout, parts of its reference and its HTML export's injection are generated from the app by
`pnpm schemas`, and a unit test fails when they're stale.

**Releasing the skill.** Its HTML export's viewer (`scripts/lib/viewer-template.html` and `icons.json`) is refreshed only
with `pnpm regen` (or `pnpm skill:release`) when you want Claude Code users to get the latest
viewer. It rebuilds them; commit what it changes.
Plugin updates track git commits; PRs never bump a version. The site's `/skill/` folder and
zip always carry the current viewer, and `pnpm skill:check` (nightly) reports a stale committed copy.
`pnpm sync` resolves generated-file conflicts without local merge-driver configuration.

## Run your own copy

The app is static files, so a company can host its own copy behind its own sign-in and keep every diagram inside its
network. `pnpm build:internal` builds one with share links and AI tools off and new diagrams private, and
`VITE_BRAND_NAME` names it. The [self-hosting guide](docs/SELF-HOSTING.md) covers Docker/Compose, Kubernetes/Helm,
static-host templates, SSO, generated security headers, verification, offline bundles and upgrades.

## Development

```sh
pnpm install
pnpm dev            # http://localhost:5173
pnpm check          # typecheck, lint, unit tests (Vitest), e2e tests (Playwright)
pnpm build          # production build in dist/
pnpm build:internal # the same for a self-hosted copy (docs/SELF-HOSTING.md)
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
| `docs/SELF-HOSTING.md`  | Running your own copy: the switches, hosting behind SSO, headers and updates     |
| `docs/ICONS.md`         | Icon sources and licences                                                        |
| `docs/QUALITY.md`       | The quality loop: checks, Codex reviews, and UX gates                            |
| `docs/design-review/`   | UX review fragments (history linked from `docs/DESIGN-REVIEW.md`)                |
| `docs/BACKLOG.md`       | Known follow-ups                                                                 |

## License

MIT. See `LICENSE`. Icons keep their own licences (below).

## Icons and trademarks

Product logos and service icons are trademarks of their owners and are used to identify those products in
architecture diagrams. Sources and licences are listed in `docs/ICONS.md`.

## Parallel contributions

Add one dated Markdown fragment per PR under `docs/release-notes/` and `docs/design-review/`, rather than
editing a shared log. Use `pnpm notes` to read release notes, `pnpm regen` to refresh generated artifacts,
and `pnpm sync` to rebase with mechanical conflict resolution. See [the workflow](docs/PARALLEL-WORK.md).
