## Five large, realistic showcase examples (2026-10-18)

The gallery gains five invented full systems of 40–60 nodes. Each opens first in its theme and tells two or three
narrated stories that show their feature within ten seconds of Live. Narration notes focus the camera, so a large
diagram stays readable while a story plays.

| Example                                                      | Theme           | Size                                                      | Stories                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | --------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Black Friday commerce platform (`black-friday-commerce`)     | Cloud apps      | 60 nodes, 73 connections, 11 boundaries (nested)          | Doors open (5× spike: checkout quota 429s, HPA 2→6, KEDA fulfilment), a bad Loyalty deploy (poison events park in the DLQ, other groups carry on, triage replays after rollback), the warehouse partner throttles (scaling consumers meets a 60/s partner quota) |
| Cell-based bookings in three regions (`cell-based-bookings`) | Reliability     | 53 nodes, 76 connections, 11 boundaries (region ⊃ cell)   | us-east-1 goes dark (DNS health checks move travellers; global tables keep every booking), a bad deploy stays in one cell                                                                                                                                        |
| Payments platform with a ledger (`payments-ledger`)          | Integration     | 49 nodes, 53 connections, 10 boundaries (PCI zone nested) | Adyen browns out (a weighted PSP router keeps its split until on-call shifts it), a poison dispute notification (DLQ, then redrive)                                                                                                                              |
| Food delivery dispatch (`delivery-dispatch`)                 | Event streaming | 40 nodes, 45 connections, 14 boundaries                   | Friday dinner rush (KEDA, maps API quota), eight partitions cap KEDA until the topic grows                                                                                                                                                                       |
| EV charging network (`ev-charging-network`)                  | Event streaming | 41 nodes, 46 connections, 11 boundaries, an OT zone       | The depot firewall blocks a vendor shell, a firmware wave reboots the street fleet, the depot firewall fails over                                                                                                                                                |

The examples demonstrate, together: request routing (three route tables, weighted targets, a live weight change),
rate limits (gateway route quotas and partner API quotas), HPA and KEDA autoscaling, partitions, nested boundaries,
a zone, notes, every dependency relation (config, secret, identity, telemetry, deploy, depends), network devices with
an HA failover and a deny rule, outboxes, DLQs with triage and redrive, typed filters, and change-data capture.
All five pass the architecture checks with no findings. Run simulations reports only the cells example's planned
losses (a dark region's in-flight requests, a failing canary cell). Feature tags come from `scripts/example-shows.ts`:
commerce and dispatch show partitions, rate limits, autoscaling and routing; payments shows partitions, rate limits
and routing; EV charging shows partitions, rate limits and network devices; cells has none of the four tags.

Layouts use the app's own boundary fitting around block-arranged services; every one routes with no geometry audit
violations. Live stays well under the adaptive threshold (at most 133 nodes plus connections per example).

Tests: `src/examples/largeShowcases.test.ts` pins each story's mechanics (quota rejections by route, replica growth,
per-group isolation, replication counts, cell blast radius, unchanged Adyen calls after the weight shift, the
partition ceiling, firewall blocks and failover). Existing example tests list the new files: checks (no findings; the
cells' two planned losses), gallery filters, three-simulation counts for commerce and EV charging, the geometry route
snapshot, and the picker, gallery and 1920-pixel Live showcase specs. The P3 precision gate compares materialized P2
copies only for examples without managed APIs, as it already did for p3 files; the existing p3-a1 examples are still
compared. No existing example is changed, retired or re-featured; the owner's retire/merge decisions are in
`docs/backlog/2026-10-18-example-gallery-decisions.md`.

### Parity

`pnpm parity:update` reported 2,386 goldens: **190 added, 1 changed**, 0 missing, 0 removed. Every existing
diagram, simulation, checks, export, layout, trace and browser golden is unchanged.

- **Added (190), new inputs only.** For each of the five examples: `node/sim` (free play and every saved run, 17),
  `node/checks`, `node/checks-words`, `node/evidence`, `node/planning`, `node/planning-p2`, `node/layout`,
  `node/routes` (5 each), `node/agent` describe/check/edit (15), `node/exports` (native, draw.io, Mermaid,
  Interactive HTML and import reports, 55), `node/trace` (journeys, sequence fingerprints, slow-motion scripts, 48),
  `node/skill` per-example validation and script results (11), and `browser/render` and `browser/layout`
  (opening render and Auto-layout/Tidy, 5 each).
- **Changed (1): `node/skill/current-stencils.json`.** The generated skill stencil reference
  (`skills/livediagrams/reference/stencils.md`, refreshed by `pnpm regen`) lists the stencils most used in the
  public examples; the new examples change that ranking (it now leads with `kafka.topic`, `service.go`,
  `redis.cache`, `service.java`). Only its hash and size (17,472 → 17,476 bytes) change. The frozen original
  cohort's `node/skill/files.json` and the validation transcript `node/skill/validate.txt` are unchanged.
