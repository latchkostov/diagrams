## Four more full systems: recommendations, video on demand, observability, a hybrid network (2026-10-18)

The **Full systems** theme gains the last four approved large examples. Each is an invented system of 41–48 nodes
with narrated stories that start within ten seconds of Live, and two of them put the newest Live features to work:
fault drills (#173) and sampled latency percentiles (#171).

| Example                                                                | Size                                    | Stories                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recommendations with a feature store (`recommendations-feature-store`) | 48 nodes, 67 connections, 8 boundaries  | Friday night peak (HPA adds Ranker v7 pods), the canary misbehaves (5% to v8 until on-call sets its weight to zero), **drill:** the feature server slows down (slow-dependency 10×: rankings queue, then drain), Sunday picks wake the batch scorer (KEDA from zero, capped by 16 partitions) |
| Video-on-demand pipeline (`video-on-demand-pipeline`)                  | 43 nodes, 54 connections, 7 boundaries  | Premiere day: where the encode time goes (a spike doubles the 4K encoders' p95; the growth is waiting, and hover shows it), a batch of corrupt sources (4K jobs dead-letter to triage; HD and audio carry on), premiere night (the CDN route table sends 97% of segments to the edge cache)   |
| Observability pipeline (`observability-pipeline`)                      | 41 nodes, 49 connections, 10 boundaries | An incident log storm (gateway collectors scale on CPU, Kafka absorbs the logs, traces and metrics never fall behind), **drill:** Loki is down for ten seconds (the Loki write path boundary goes down; logs wait in Kafka, none lost)                                                        |
| Hybrid enterprise network (`hybrid-enterprise-network`)                | 41 nodes, 47 connections, 8 boundaries  | **Drill:** the Leicester fibre is cut (region-connectivity: health checks move new tunnels to LTE; only the two requests on the wire are lost), the DC firewall pair fails over, a guest device probes the ERP (the guest zone's deny rule blocks it)                                         |

Together they show request routing (a home-page route table, a weighted canary router, a CDN route table), HPA and
KEDA (Kafka lag and SQS depth, one scaler sleeping at zero), a shadow model on a mirrored share, a partner quota
(DRM keys), per-signal Kafka buffering, network devices (campus and data-centre switches, firewall pairs, an ADC,
SD-WAN routers), a deny rule, DLQs with triage, typed filters, and config, secret, identity, telemetry, deploy and
depends relations. All four pass the architecture checks with no findings. Run simulations reports two planned
losses: the canary's failed rankings, and the two requests on the Leicester fibre when it's cut. Feature tags
(`scripts/example-shows.ts`): recommendations shows fault drills, partitions, autoscaling and routing; video on demand
shows latency, partitions, rate limits, autoscaling and routing; observability shows fault drills, partitions, rate
limits and autoscaling; the network shows fault drills and network devices.

Layouts use block placement and the app's boundary fitting; every example routes with no geometry audit violations,
and every narration note's focus renders at 60% zoom or more on a 1920 × 1080 desktop.

### #167 review follow-ups

All five #167 P2s were fixed in #172 and are still covered: the cells' regional close-ups (each note's focus is
checked at 60% desktop zoom), the EV `StartSession` branch reaching billing and the `UpdateFirmware` DLQ retry (unit
test), "large showcases focus the current narration" (at 1920 and 390, asserting what the phone camera does), and
"dispatch opens the requested partition-ceiling story". The four new examples join the first and third.

### Tests

- `src/examples/largeShowcases.test.ts` adds the four to the size, layout, close-up and determinism checks, and pins
  each story's mechanics: HPA growth and the canary's weight change, the slow-dependency queue and drain, KEDA from
  zero up to the partition count, the 4K encoders' p95 doubling with at least a quarter of it waiting, corrupt jobs
  reaching triage only from the 4K ladder, the edge cache's share, Kafka lag on logs only during the storm, no Loki
  writes during the outage drill while ClickHouse carries on, LTE carrying every new Leicester tunnel during the cut,
  a loss-free firewall failover and the guest deny rule.
- Existing lists name the new files: checks (no findings, two planned losses), saved-simulation counts, gallery
  order and feature filters, the geometry route snapshot, the picker's theme list, and the 1920 story and narration
  focus specs.

### Parity

`pnpm parity:update` reported 2,525 goldens: **161 added, 1 changed**, 0 missing, 0 removed.

- **Added (161), new inputs only:** `node/sim` (16), `node/trace` (45), `node/exports` (44), `node/agent` (12),
  `node/skill` (8), four each of `node/checks`, `node/checks-words`, `node/evidence`, `node/planning`,
  `node/planning-p2`, `node/layout` and `node/routes`, and four each of `browser/render` and `browser/layout`.
- **Changed (1): `node/skill/current-stencils.json`.** The regenerated skill stencil reference ranks the stencils
  most used in public examples; the new examples change that ranking, so only its hash and size change.
