# Output parity

A safety net for refactoring and performance work: a harness that records what the app produces from a diagram
(golden files) and fails when any of it changes. A refactor that passes changed nothing the harness can observe. A
change meant to alter output updates the goldens on purpose, in the same pull request, and the goldens' diff is the
review of that change.

```sh
pnpm parity            # check everything: the Node tier, then the browser tier (in Docker, below)
pnpm parity:node       # the Node tier alone (about 15 s)
pnpm parity:browser    # the browser tier alone (about 45 s, a few minutes the first time)
pnpm parity:update     # re-record the goldens and print what changed (refused on CI)
pnpm parity sim checks # only parity files whose path contains "sim" or "checks", in the tiers that have one
```

A filtered run skips the stale-golden check. The browser tier needs Docker running (see "Browser tier").
Without it, `pnpm parity:node` still checks everything that doesn't need a browser.

## Example gallery verification round (2026-10-15)

These fixes change save-destination ownership, launch queuing, retained conversation memory and
selection autosave scheduling. They deliberately change no diagram output. No golden is updated;
the refreshed skill viewer's built script is already excluded from byte pinning, while its behavior
remains covered by the existing viewer goldens.

## What's pinned

Inputs are fixed: the public examples (`src/examples/*.json`, top level only: `src/examples/private/` is never listed
or read), the import fixtures in `tests/fixtures` and `src/interop/drawio/fixtures`, and the harness's own corpus in
`tests/parity/corpus`: diagrams frozen once from the Lab's fixtures and generators (planning P1 and P2, the export
contract, relationships, layers, colours, text fields, edge kinds, sides and fan-outs, groups, cycles, the routing
courses and the Lab's simulation scenarios), the three checks fixtures, a few diagrams that sit exactly on the checks'
thresholds (a sync chain of 3 and of 4 hops, a service at 79%, 80%, 99% and 100% of its capacity), planning P3
diagrams (Stripe, a generic external API, Lambda, API Gateway and OpenAI from the Lab's P3 fixture, two OpenAI callers
with separate allocations and a token quota, and a shared account quota with an endpoint budget whose saved
simulations burst 200 calls at scale 1 and at scale 10), and Mermaid inputs. Freezing them keeps a Lab edit from
moving a golden; the corpus is what caught the latency default change below, since every public example sets its
latencies.

- **Simulation** (`node/sim/<diagram>/<simulation>.json`): each diagram played exactly as the live view plays it
  (`new LiveController(diagram)`, `src/live/LiveSession.tsx`): every saved simulation to its end, and free play
  (traffic on, the automatic dot scale) for 60 simulated seconds. Per run: the run state (time, done, scale,
  multipliers, expectations with their values, markers), the narration notes, per-node counters every 10 simulated
  seconds (processed, failed, dropped, outage drops, blocked, rejected by admission and why, dead-lettered, backlog,
  lag per group, in flight, throughput, kept with no consumer, failing over, replicas configured/active/idle), the
  final counters in real units, edge delivery totals, the whole event stream, and latency statistics (end to end, and
  wait and processing per node: count, min, mean, p50, p90, max) from the message tracer.
- **Capacity and planning** (`node/planning*/`): configured planning as the inspector and hover card read it
  (`configuredPlanning`), in edit mode and with each saved simulation selected: `analyzeCapacity` (per node and per
  connection), the P1–P3 explanations (`explainNode`, managed APIs and quotas included), capability rows, sizing and
  redundancy fixes, resolved settings; broker assignments; automatic dot scales; the heat map and callout
  (`capacityView`) for every Inputs preset; partition notes. Every example also upgraded (`upgradePlanning`, to p3
  since P3) with the same records, and its legacy export's losses. P3's vendor presets: the published revision, each
  preset's scoped budgets, and which stencils are managed and what a new one gets (`node/admission/`).
- **Run simulations** (`node/evidence/`): `collectEvidence` with a fake clock, `withEvidence` (planned and counted
  losses), the agent report with simulations.
- **Traces** (`node/trace/`): `traceOnce` in free play and in each saved simulation (and its first dead letter): the
  steps, the trace card's journey, the sequence diagram's model, its Mermaid text and its SVG (light and dark, by
  hash), and slow motion's script (beats and their timing, reduced motion too).
- **Architecture checks** (`node/checks*/`): `runChecks` as language-neutral data (ids, rules, severities, targets,
  elements, fix ops and options, broker data), each fix applied with `applyOps` and checked again; the English words
  (titles, messages, rationales, fix labels, the panel's wording) and `agentReport` in a golden of their own; the rule
  catalogue.
- **Exports** (`node/exports/`): `.diagram.json` as the app saves it, byte for byte, and that reopening and saving
  again gives the same bytes; draw.io XML (and with its inlined icons, by hash), and reading it back; Mermaid with and
  without its metadata, and reading it back; the Interactive HTML file's page and payload, built by the same functions
  as the build with placeholder viewer code.
- **Imports** (`node/imports/`): compose, AsyncAPI (each and joined), Kubernetes, Terraform (AWS plan, Azure state),
  draw.io (pages, compressed), Mermaid, hostile and unknown input, through the front door the app uses
  (`importFiles`/`importText`): the diagram, warnings, the report (its texts as language-neutral codes, and in
  English), Draw everything replays, the checks on the result, and format detection.
- **Agent surfaces** (`node/agent/`): the WebMCP tool list (names, descriptions, schemas, annotations), and through
  the real tools and adapter on a fake editor: `describe_diagram` (text, JSON, focus), `check_diagram` (all, warnings,
  two rules, with simulations), `find_stencils` (22 queries), and per example an `edit_diagram` script using every op
  kind, a bad reference and a dry run, then `set_simulation` (and a refused one), with what the AI panel records.
- **Contracts and skill** (`node/skill/`): `public/schema/*` as generated (by hash, with their properties and
  definitions), the skill's generated data and references (by hash), and the skill's scripts run as an agent runs
  them: `validate.mjs` on every diagram, `layout.mjs`, `share-link.mjs` (what the link decodes to) and
  `export-html.mjs` (its payload) on every example.
- **Layout and routing** (`node/layout/`, `node/routes/`): on estimated card sizes: auto-layout in both directions,
  Tidy, align, distribute, spread, boundary around, the skill's layout, and every edge's route in each style (points,
  sides, label placement, the SVG path by hash), from the routing input the canvas itself builds
  (`routeInputFromStore`: notes and shapes are obstacles, shapes take edges).
- **Languages** (`node/i18n/`): in every language and the pseudo-locale: a dozen messages through the real runtime
  (plain, plurals at 0, 1, 2, 5, 21 and 1000, selects, numbers, a rich message rendered to HTML) and the number,
  percent, rate, duration, list, byte and date formatters; and every message of every catalog, each select option and
  plural category rendered with sample values, as one hash per language and area, with the count that falls back to
  English.
- **Canvas** (`browser/render/`, `browser/layout/`): every example opened on the production build: each node's box
  (position and measured size) and text, each edge's path, each label's placement and the fitted view; then after
  Auto-layout, and after Tidy up of everything.
- **Images** (`browser/images/`): image export of three examples in both themes: the SVG's structure (one element per
  line: data-testids, classes, text, geometry, a few visual properties, embedded data by hash) and the PNG (a tolerant
  image diff against a stored, downscaled reference).
- **Interactive HTML** (`browser/html/`): the file the app downloads for two examples (defaults, and dark with a
  banner, not playing), normalised (below), its payload, and what it draws opened from `file://`: its geometry, and a
  screenshot (the viewer's own CSS, its banner and footer) compared like the PNG export.

### Deliberately not pinned

**TODO (`test/parity-browser-stable`, PR #120):** once the browser measurement fix lands, remove the
precise deferrals in `tests/parity/browser/render.parity.ts` and record the eight missing cases:

- Opening canvas renders: `contoso-dmz`, `shared-api-quotas`.
- Auto-layout **and** Tidy results for each of `contoso-dmz`, `measured-order-capacity`,
  `partitions-vs-subscriptions`, `serverless-burst-buffer`, `shared-api-quotas`, `shared-worker-pool`
  (six cases, each pinning both operations).

Verify settled measured boxes, routed edges, text and labels before recording. The other four showcase
opening renders, every existing browser case, all six showcases' Node goldens and production Live tests
stay enabled. This is a temporary coverage gap, not a permanent output exclusion; do not re-record
existing goldens to accept measurement drift.

- **Built code.** Minified bundles, chunk names, the viewer's script and style, the skill's `app.mjs` and `inject.mjs`
  and the released viewer template: a refactor changes them by design. What they _do_ is pinned (the HTML file is
  opened in a browser, the skill's scripts are run). The skill's generated files are pinned as committed;
  `src/ai/skill/skill.test.ts` keeps them equal to what `pnpm schemas` generates.
- **Wall-clock behaviour.** Frame rates, animation, slow motion's playback (its script is pinned, not its pacing in
  real time), video recording. Nothing in the harness reads a clock.
- **Password-locked HTML.** Its salt and IV are random by design; the unlocked payload is pinned, and
  `src/export/lock.test.ts` covers the envelope.
- **Share links' bytes.** DEFLATE output may differ between zlib versions; what a link decodes to is pinned.
- **Storage, sign-in, Google Drive and the on-device model.** Random ids, timestamps and model output by design;
  each has its own tests.
- **The chrome.** Menus, dialogs, the inspector and toasts are the e2e suite's. This harness pins what a diagram
  produces.
- **Pixel-exact PNGs.** Rasterisers differ between CPUs; see "Browser tier".
- **The automatic fit on opening.** Its framing depends on timing (see "App behaviour found" below); the harness
  pins Fit view instead. The Interactive HTML viewer waits for fonts and layout, then zooms and fits explicitly;
  omitting that fit fails deterministically instead of depending on startup timing.

## Determinism

Every source of variation is removed at the input rather than tolerated at the output.

- **Seeds.** Saved simulations carry their seed (every public example's does: `src/sim/examples.test.ts`); free
  play and traces use the live view's (7). Nothing creates an engine without a seed.
- **Clocks.** Simulation time is the engine's 10 ms tick, stepped by the harness: no timers, no `Date.now`. The
  Run simulations budget (`collectEvidence`) and `check_diagram`'s get a still clock, so a slow machine can't turn
  a played simulation into an unplayed one. Exports get a fixed date; the browser's export date is normalised.
- **Ids** are counters in the app (`src/editor/ids.ts`, `src/model/ids.ts`), so nothing needs normalising.
- **Private diagrams are never loaded.** Vitest runs with `DEV` set, where the examples registry imports
  `src/examples/private` eagerly; the Node tier's config empties that glob and refuses any module from the folder
  (`tests/parity/vitest.config.ts`). The browser tier serves a production build, which has none.
- **Order** is the output's own (findings, nodes in an export, keys in a file). Records the harness builds follow
  diagram order.
- **Language and time zone.** The Node tier resets the i18n state to English around every test; the i18n file sets
  each language itself. Dates are formatted in UTC. The browser runs in English, UTC, light scheme, reduced
  motion, 1440 × 900 at a device scale of 1.
- **Floats are compared exactly**, everywhere: the engine, analysis and router use IEEE arithmetic and V8's
  `Math.exp`/`Math.hypot`/`Math.log10` (fdlibm, the same on every platform). The Node tier gives identical goldens
  on Windows with Node 20, and on Linux with Node 22 and Node 24, `Intl` output included. `-0` prints as `0`;
  `Infinity` and `NaN` (capacity's "can't keep up") print as strings, since JSON has neither.
- **The event stream is recorded whole or not at all.** The engine keeps only its 200 latest events, so the harness
  reads the log after every tick and fails if a tick could have overflowed it. (That's why the corpus's 513-copies
  diagram, which exists for the planning budget, is pinned by planning and checks only.)
- **The one tolerance** is the PNG comparison, below.

### Browser tier

Text measures differently on each operating system: the same build drew a card 230 px wide on Windows and 223 px on
Linux, which moves routes, labels and the fit. So the browser tier always runs in one environment: Playwright's own
Linux image for the installed Playwright version (`mcr.microsoft.com/playwright:v<version>-noble`), through Docker, on
a laptop and on CI alike (`scripts/parity.mjs` starts it with the checkout mounted; Linux's `node_modules`, one volume
per checkout, and the pnpm store live in Docker volumes, not in the checkout). Inside it, the harness builds the
production bundle (`vite build`, no test hooks) and serves it with `vite preview` on port 6200.

In that image, two runs give identical numbers and pixel-identical images, so the canvas and SVG goldens compare
exactly. The PNG comparison keeps a tolerance: both images are downscaled by 4 and at most 0.1% of the pixels may
differ by more than 16 of 255 in a channel. It absorbs rasteriser differences between host CPUs (the same image on
another machine); Windows against Linux differed by 1.2 to 1.5%, and a 1 px change to the card's gap gave 0.37%. A
single thin line can hide under it, which is what the SVG structure is for.

The Interactive HTML file is compared byte for byte after three normalisations: the export date (today), the
viewer's inline script and style (build output) and their hashes in the Content-Security-Policy. Its payload is
pinned as data, icons by hash.

`PARITY_BROWSER_HOST=1` runs the browser tier on the host instead, for debugging; expect differences off Linux.

## Storage

Goldens live in `tests/parity/goldens/<tier>/<area>/…`, committed with LF line endings, outside Prettier (their
printer formats them).

- **Readable JSON** for what a reviewer reads: counters, findings, explanations, layouts, reports.
  `tests/parity/lib/stable.ts` prints small values on one line (up to 120 characters) and a record (an object of
  plain values: a trace step, a route, a beat) on one line up to 400, so a change is a one-line diff; key order is
  the output's own.
- **Text** for outputs that are text (`.drawio`, `.mmd`, `.diagram.json`, the HTML page, the SVG's structure), so the
  goldens' git diff is the review.
- **Hashes beside summaries** where the full output is large and the summary says what changed: the event stream
  (a hash per simulated second, beside counters every 10 seconds: a diff says _when_ a run diverged and _what_
  diverged), catalogs (per language and area), sequence SVGs, embedded icons and fonts, route paths (beside their
  points).
- **Images**: eight downscaled PNG references (six image exports, two viewer screenshots), the only binary goldens.

There are about 1,425 goldens: 11 MB on disk, 1.4 MB compressed, which is what a full re-record adds to the
repository's history; a typical change rewrites a few files. Hashing everything would be smaller and unreadable;
recording everything (each event, each rendered message) would be ten times the size for detail that the summaries
point to anyway. On a failure, every actual output is written to `tests/.output/parity/actual/` and every diff to
`tests/.output/parity/diffs/` (CI uploads both as `parity-output`), so the full detail is one download away.

## Updating

`pnpm parity:update` re-runs everything with `PARITY_UPDATE=1`, rewrites the goldens that changed, adds new ones,
deletes those nothing produces any more (after a full run only, never with a filter), and prints a summary:

```
Parity (update): 1310 goldens, 2 changed, 0 added, 0 missing, 0 removed
  changed  node/i18n/messages.json  (1)  de["file.new"]: "Neues Diagramm" → "Neues Schaubild"
  changed  node/i18n/catalogs.json  (1)  de.areas.file: "e463c8183b00" → "128284c5b840"
```

A golden is never rewritten when it matches (a PNG within its tolerance stays as it is). Review the goldens' diff
like code: it is exactly what the change does to the output. With `CI` set, `pnpm parity:update` refuses to run.

### Updating goldens for a feature PR

A pull request that changes output on purpose runs `pnpm parity:update` (Docker running, for the browser tier), commits
the goldens with the code, and explains the diff in its description: which areas changed and why each change
follows from the feature. Anything the description can't explain is a regression to fix, not a golden to accept.
New behaviour gets new inputs (a corpus diagram, a saved simulation) so its output is pinned from the start. The
example below is the first one.

### Nested boundaries review (#115): what changed and why

The final verification round changes only `node/i18n/catalogs.json`: `edit.annotationTextLimit`
adds the boundary-to-zone label-length rejection and recovery guidance in English and all 37
translated catalogs. Each catalog's message count increases by one and its `edit` hash changes;
fallback counts stay unchanged. The membership, cycle, traversal, selection, tone and caption fixes
leave every recorded diagram, simulation, layout, import, export and browser golden unchanged.

The review fixes change only `node/i18n/catalogs.json`: `edit.annotationLimit` adds the
boundary-to-zone annotation-count rejection and its recovery guidance. Every catalog's message
count increases by one and the `edit` area hash changes; all 37 translated catalogs include the new
message, so fallback counts stay unchanged. No diagram, simulation, layout, export, image or browser golden changes. The
hierarchy traversal improvements preserve all recorded output. The refreshed skill viewer and plugin
version are checked against the committed release without changing the skill reference goldens.

### Planning P3 (#105): what changed and why

Rebasing this harness onto P3 changed 21 goldens and nothing else:

- `node/planning-p2/*` (all 17): `upgradePlanning` now upgrades to revision p3, so every upgraded example says
  `p3`, its managed nodes (gateways, external APIs, serverless, model APIs) get the `managed-measured` preset and
  P3's managed fields, and their explanations, capacities and heat map follow from those.
- `node/skill/public-schemas.json`, `node/skill/files.json`: the file format gained P3's fields (`api`, quotas,
  endpoints, shared allocations, the new presets), so `diagram.v1/v2.json`, `ops.v1.json` and the skill's
  `reference/format.md` changed.
- `node/agent/tools.json`: the tools' schemas carry the same new node properties and presets.
- `node/i18n/catalogs.json`: 29 new P3 messages in English and every catalog (some still fall back to English).

No simulation, check, export, import, layout or browser golden moved: every pinned diagram was legacy, p1 or p2,
and P3 keeps their behaviour exactly. The P3 corpus diagrams, the `rejected` counters and reasons, and the
presets golden were added in the same change, so P3's own output is pinned from here on.

### Autoscaling A1: what changed and why

Rebasing A1 onto the harness changes only these existing goldens:

- `node/skill/public-schemas.json`: `diagram.v1/v2.json` and `ops.v1.json` gain resource costs,
  HPA configuration and the `p3-a1` revision; the v1 schema describes the optional properties while
  native validation still requires the explicit v2/A1 opt-in for execution.
- `node/agent/tools.json`: the real agent tools carry those same resource/HPA properties and revision.
- `node/skill/files.json`: the generated format reference/spec describe A1; the generated stencil
  reference's popularity order includes the added public example (browser, Kafka, Go workers and S3).
- `node/i18n/catalogs.json`: English and all 37 catalogs gain A1 controls, resource/lifecycle readouts,
  decision reasons and planning/check explanations; older messages retain their rendered output.
- `node/skill/validate.txt`: six additional validation records, for the showcase and five frozen A1
  diagrams. Earlier records and the deliberately invalid corpus results remain unchanged.

No existing simulation, check, export, import, layout, browser or planning-upgrade golden changes.
The first run caught a legacy arithmetic regression: multiplying replicas after dividing service
time changed a rounding boundary and recommended 37 replicas instead of 36. The legacy operation
order is restored and a negative-control regression test fails when the fix is removed.

New goldens for `autoscaling-image-workers` cover all normal per-example surfaces, including its two
saved bursts and free play, planning and explicit upgrade, checks and evidence, exports and round trips,
agent scripts, traces, routes/layout and browser geometry. Its draw.io round trip also guards retention
of the v2 planning revision. The only new geometry unit snapshot is this example's three connections.

Five frozen `a1-*` corpus diagrams cover burst growth, the published 300 s scale-down stabilization
window, maximum reached, eight replicas sharing three partitions, and an 8 s startup delay with backlog.
They receive the normal corpus coverage. Seven additional `node/autoscaling/*` goldens (five corpus runs
and two showcase simulations) pin every simulated second's desired/ready/starting/draining counts,
active/idle replicas, backlog, completed work, controller decisions, actual English decision copy and
configured resource explanations. The max scenario requires ten replicas at target with a maximum of
two; its explanation cautions that startup and partitions still apply. The showcase's deliberately short
sync/window/startup timings are saved in the input and disclosed in its description.

### Autoscaling A1 round 2 review fixes (2026-10-15)

All 1,552 goldens remain unchanged: legacy, non-autoscaling and A1 simulation, planning, export,
import, agent, layout and browser outputs. No golden was re-recorded. Existing corpus scenarios do
not exercise occupied-replica concurrency edits, retained resource retries through an outage,
shrinking during a long startup, or invalid inspector/paste commits. Focused unit and production
browser regressions cover those edge cases, plus numeric replica CPU readings. Operation-count
negative controls cover sampled admission, startup hashing, drain readouts and page expansion.
The released offline viewer is refreshed without changing its pinned legacy outputs or payloads.

### Autoscaling A1 round 3 review fixes (2026-10-15)

All 1,552 goldens match, with none changed, added, missing or stale. Legacy, non-autoscaling
and A1 outputs retain their existing records. Frozen A1 runs do not save free-play inputs after advancing, pause individual lifecycle
clocks, submit invalid editor/live batches or inspect paginated startup cohorts; dedicated
regressions and deliberate reversions cover those cases. Memory and absolute CPU controller
recommendations now have numerical tests at exact and sampled scales. The shared native/editor
validator changes generated skill implementation code, which is deliberately not pinned; its
public schemas, payloads and existing validation outputs remain unchanged.

### Adding an output

Call `expectGolden` (data), `expectGoldenText` (text) or `expectGoldenBinary` (with a comparison)
from a `*.parity.ts` file under `tests/parity/node` (Vitest) or `tests/parity/browser` (Playwright, importing `test`
from `./fixtures`), then `pnpm parity:update`. Mismatches are collected and reported together after each test, and
the summary also fails on any mismatch in its ledger.

## CI

The **Output parity** job in `.github/workflows/ci.yml` runs `pnpm parity` on every event (the skill's references
are Markdown, so a docs-only change can move a golden) and the **CI** gate requires it. It type-checks the harness,
runs the Node tier on Node 24, and the browser tier in the same Playwright image as a laptop. It fails on any
difference, missing golden or stale golden; the diffs are in the log and in the job summary, and the actual outputs
are uploaded on failure.

## Runtime

On a laptop: the Node tier about 15 s (1,355 goldens in parallel workers; simulations split over three files), the
browser tier about 45 s with warm Docker volumes (70 goldens; the first run installs Linux dependencies into a
volume and takes a few minutes). On CI, add the image pull and an install inside it.

## App behaviour found

- **The automatic fit on opening depends on timing.** It keeps clear of the floating chrome on screen at that
  moment, and under load some of it arrives later, so the same example opened twice can be framed differently
  (webhook-ingestion: zoom 0.4036 in most runs, 0.4078 in one; cqrs-event-sourcing: 0.4751 and 0.4802). Not fixed
  here (it's behaviour, not the harness's to change); the harness presses Fit view once the canvas has settled.

## How it was checked

- **Positive control:** two full runs in a row on unchanged master pass, and so does a fresh clone of the branch.
- **Negative controls**, each made alone, run, and reverted:
  - a processor's default latency 250 → 251 ms (`src/sim/defaults.ts`): 52 goldens, among them the simulations,
    planning and `describe_diagram` of the corpus diagrams that rely on defaults
    (`s0.throughput: 2.4406… → 2.4474…`, capacity `16 → 15.936…`);
  - the sync-chain threshold 4 → 5 hops (`src/checks/rules/syncChain.ts`): the 4-hop corpus diagram's finding, its
    words, the agent report and the rule catalogue (4 goldens);
  - two attributes of draw.io's root cell swapped (`src/interop/drawio/write.ts`): 86 goldens, shown as a line diff;
  - one German message changed: a pinned one (`de["file.new"]`) and one that isn't (`de.areas.storageDialog`);
  - the node card's gap 12 → 11 px (`src/styles/app.css`): 46 browser goldens (render, layout, SVG structure, PNG
    at 0.37%, the HTML viewer).
- **Flake check:** five full runs in a row, no differences.

## Autoscaling A1 round 4 (2026-10-15)

Three shared contract/catalog goldens intentionally change:

- `node/skill/public-schemas.json`: diagram v1/v2 schema hashes and the v2 definition list change.
  Resource/autoscaling properties are forbidden before p3-a1, including simulation setup/timeline
  patches. V2 adds legacy property/simulation definitions for its older revisions; the general patch
  schema is unchanged.
- `node/i18n/catalogs.json`: the A1 CPU-work refusal recovery message adds one English source key.
  The per-language message count and autoscaling-area hash change, and untranslated languages count
  its English fallback. No other language area changes.

- `node/skill/current-stencils.json`: rebasing onto the six new master showcases regenerates the
  current stencil usage ranking with the existing A1 showcase included. The old aggregate skill
  inputs remain frozen at their existing 18 examples, so `skill/files.json` and `skill/validate.txt`
  stay unchanged; the six new showcase validations keep master's individual coverage.

Every simulation/controller, planning, check, trace, route, layout, export, import and browser golden
is unchanged, including all A1 scenarios. The runtime fixes exercise edge cases outside the frozen
runs; their failing-without-the-fix regressions and per-step invariants cover them separately. No
simulation golden was re-recorded to accommodate a failure.
