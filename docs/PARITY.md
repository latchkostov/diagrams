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

## Autoscaling A3: what changed and why (2026-10-16)

A3 adds ten frozen `a3-*` corpus diagrams (one per adapter: ECS ALB target tracking, ECS step scaling,
Container Apps HTTP and event, App Service, Cloud Run; and the planner's max, target, partitions and quota
cases), the public `cloud-run-timetable-api` showcase and a Terraform scaling fixture. Every legacy, A1 and A2
**diagram-output** golden is unchanged: no simulation, replica history, checks, describe, export, layout or
renderer output of an existing diagram moved. New goldens cover the new inputs everywhere the harness reads
diagrams (simulation, checks and their words, evidence, agent describe/check/edit, native, draw.io and Mermaid
exports, Interactive HTML, layout and render).

`node/autoscaling.parity.ts` gains an A3 block: for each A3 diagram and simulation, every controller second
(desired, ready, starting, draining, backlog, processed, rejections, the full decision with adapter, metric kind,
policy and alarm periods, and the translated reason and metric words), plus `plan.json`, the scenario planner's
complete result with the English sentence agents receive and the translated sentence Checks and Live details
show. A plan golden freezes the research example: at 3× traffic, HPA max 10 at 92% of request with a 70%
target suggests max 14, verified by a same-seed rerun.

The update adds **229 goldens** and changes **six** shared goldens (2,091 in all: 2,003 node, 88 browser); every
other existing golden is unchanged. Changed shared goldens, each for one reason:

| Golden                           | Reason                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `node/agent/tools.json`          | Agent input schemas accept the A3 controller union (`modelRevision: "a3"`: ECS, Container Apps, App Service, Cloud Run).    |
| `node/skill/public-schemas.json` | Hashes and sizes of the regenerated v2 diagram and v1 ops schemas, for the same contracts.                                  |
| `node/skill/files.json`          | The generated format reference describes the cloud controllers and scenario sizing.                                         |
| `node/skill/validate.txt`        | The validation transcript lists the ten new frozen corpus inputs.                                                           |
| `node/imports/detect.json`       | Format detection covers the new Terraform scaling fixture (`terraform`).                                                    |
| `node/i18n/catalogs.json`        | The A3 messages add catalog entries and change the autoscaling area hash in every catalog; all 37 languages translate them. |

The browser tier adds the showcase's layout and render goldens; every existing browser golden matched. One
working note: two parity runs in one checkout share `tests/.output/parity`, so an update with a filter can remove
the other run's goldens as stale. That happened once during this work and was restored from the previous commit
before a solitary run; run parity tiers one at a time.

## Stencil names and agent connection defaults (2026-10-15)

Only these agent outputs intentionally change:

- `node/agent/edit/nightly-batch-elt.json`: `diagram.nodes[id=crm].label` and
  `steps[9].output.candidates[id=crm].label` change from `Salesforce` to `AWS Lambda`.
  The script changes that node's stencil while its name is still the previous default;
  the node and the later failed-reference candidate now show the new default name.
- New `node/agent/stencil-defaults.json` records an invented agent edit: a default Service
  becomes Key Vault, Credentials keeps its custom name, omitted relations infer Secret
  with inferred provenance, explicit Config stays authored, and explicit flow carries traffic
  with explicit provenance. The follow-up call resolves the node by its updated default name.
- `node/agent/tools.json` adds `flow` to the connect relation enum and replaces the obsolete
  "Leave out for a flow" description with stencil inference and explicit-override semantics.
- `node/skill/public-schemas.json` changes only `ops.v1.json`'s byte count and SHA-256 fingerprint
  for that enum and description; all other public schema fingerprints remain unchanged.

All other existing outputs must remain unchanged. No simulation, layout, export, import or
browser golden is re-recorded to accommodate these fixes. The skill viewer refresh is required
by its freshness check and does not change its output fingerprints.

The code review caught the missing explicit-flow override and a browser assertion that could
match a stencil subtitle rather than the actual name. Both are corrected: the shared connection
helper marks explicit flows authored, and the browser regression checks exact persisted stencil
and label values after the agent edit, Undo and inspector edit. Deliberately removing name
following fails the browser regression; removing explicit-flow provenance fails its unit test.

The first full gate passed shard 1 (217 tests), then found an invalid "not saved yet" setup
assumption in the page-hide test in shard 2 (191 passed, one failed). Clean master did not reproduce
it in ten isolated repeats or five complete library runs (45 tests). The test now edits an owned
document under `pauseClock()`, keeping its pending-edit and lifecycle-flush assertions. Ten repeats
pass; suppressing the actual page-hide listener registration makes its flush assertion fail.
This test-only correction changes no output golden or production persistence code.

## Static-page languages (2026-10-15)

Only `goldens/node/i18n/catalogs.json` changes. All 37 catalogs gain `staticAuth` and `staticSkill`
area hashes for 31 translated messages, and the generated pseudo-locale gains the same areas.
Message totals rise by 31; existing area hashes and English fallback counts are unchanged.
This deliberately records the new catalog surface. Every diagram, simulation, import, export,
canvas and image golden must remain unchanged. Baseline HTML hashes and browser DOM checks also
pin unchanged English content (ignoring the new stable binding attributes) for the converted
standalone pages; legal pages stay English-only. The Node parity config explicitly compiles complete
catalogs, while the app runtime excludes the standalone namespaces.

## Immediate fits and cancellable refinements (2026-10-15)

The measurement gate refines an already fitted canvas. Opening restores React Flow's initial
fit; committed nodes and panel geometry also fit before paint. A refinement still uses the
existing measured routes, fonts and chrome, preserving the settled goldens. Captured input
cancels the waiting refinement before dispatch, and stops an active fit transition at its
current viewport. Readiness subscribers for ordered document commands remain independent.
Controlled geometry also receives its early fit when React Flow's passive StoreUpdater commits
the nodes/edges, rather than fitting the previous store snapshot in the parent's layout effect.

The production regressions hold only font readiness promises, preserving real font metrics.
They inspect the first visible frame, press a node while the final fit is held and compare its
screen box/viewport across release, and open the inspector before releasing the gate. These
checks cover the usable intermediate view as well as the final settled drawing. Waiting for
the full gate before permitting interactions was rejected because it preserves the opening
UX regression. No assertions are relaxed and no golden is re-recorded for this correction.

Reverting the app correction fails all three held-font checks: the first visible drawing is
clipped, a node press leaves the refinement pending, and opening the inspector covers content.
Hover/focus regressions keep tooltips across release; the Auto-layout regression holds only
the post-commit font refinement in the existing Edge kinds Lab preset, whose cards never resize.
Without the store-commit fit it changes from `scale(0.838355)` to `scale(1.16667)` on release.
The Lab regression holds ResizeObserver delivery for the existing measured hierarchy and checks
that its render metric appears only after descendants measure, despite zero-area boundaries.
Reverting the complete app correction fails all seven of these checks. Removing the early
keyboard-zoom ownership guard independently fails the eighth regression.
The first full shard also caught an over-broad pane-size subscription: it kept early-fitting
an arbitrary resize while refinement was pending. Limiting early fits to committed geometry
restores the existing fullscreen regression; all 37 fit/fullscreen checks then pass unchanged.
The subsequent complete shard/repeat sweep isolated the tooltip and empty-boundary Lab failures;
both are fixed in the app. No pre-existing assertion or timeout is changed. The expanded focused
production run passes 73 tests across fits, fullscreen, first run and the complete Lab sweep.

UX review: the first drawing is usable, a press keeps its target still, and a newly opened panel
leaves content clear. No control or placeholder is added. User pan/zoom ownership, lazy Checks
mounts, ordered Auto-layout, Undo cancellation and idle observer cleanup retain their checks.

### Complete correction verification

All six whole-file CI shard lists from `node scripts/e2e-shard.mjs <n> 6` pass locally on the
production `VITE_E2E=1` bundle, with `CI=true`, three workers and explicit ports 6330–6334:

| Shard | Passed | Skipped | Retries |
| ----- | ------ | ------- | ------- |
| 1/6   | 227    | 0       | 0       |
| 2/6   | 155    | 0       | 0       |
| 3/6   | 208    | 0       | 0       |
| 4/6   | 252    | 0       | 0       |
| 5/6   | 255    | 0       | 0       |
| 6/6   | 203    | 0       | 0       |

The complete suite passes 1,300 tests, including dev, subpath, internal and locked projects.
The supplied failure list resolves to exactly 47 tests in 21 files; `--repeat-each=3` passes
all 141 runs without retries. No existing test assertion, selector or timeout is changed.

- Two fresh `pnpm parity` runs each compare all 1,769 goldens: zero changed, added, missing or
  stale. No update command is run.
- Four subsequent Docker browser runs alternate `PARITY_WORKERS=24` with
  `PARITY_CPU_THROTTLE=10 PARITY_WORKERS=8`. Each passes all 70 tests and compares all 84 browser
  goldens unchanged, without retries, using the second fresh production bundle.
- The full unit suite passes: 534 files, 7,201 tests, four existing skips, no type errors.
  Production build, startup chunk test and entry budget pass (105.7/123.5 kB gzip).
- Skill freshness passes with the refreshed viewer at plugin 1.1.26, exactly one patch above
  origin/master's 1.1.25. i18n reports zero errors; existing translation gaps/warnings remain.
- The implementation commit `7b6ceedf` also passes CI run
  [38828615367](https://github.com/latchkostov/diagrams/actions/runs/38828615367).

Earlier local dev trials had page-load and lazy-view timeouts while Vite scanned accumulated
HTML exports and trace snapshots as dependency entries (its default is `**/*.html`). Temporary
per-port dev caches were kept under `node_modules`, and the local dev server's dependency scan
was limited to the actual `index.html` app entry. The five affected dev checks then pass without
retries, followed by the clean shard runs above. This is a local runner configuration only;
no product Vite configuration or test behavior is changed. Temporary servers are stopped.
Automatic approval review blocked recursive scratch cleanup (`blocked by policy`, without a
detailed reason), so generated scratch builds/results remain ignored. Master remains `66583484`.

## Final P2 review follow-up (2026-10-15)

- Opening checks still run independently, but the optional title-card warning count renders only
  after the first viewport is computed, or the person takes control. The browser harness neither
  hides the count nor clicks Fit. Holding real node measurements and worker results independently,
  then releasing them in both orders, gives the same opening viewport and the existing golden.
  Reverting the app gate produces `scale(1.12414)` versus `scale(1.14674)` in that regression.
- The measurement gate disconnects its ResizeObserver and clears its element map when idle.
  Late deliveries cannot repopulate that map. The count regression checks zero retained observations
  after opening and deletion, then verifies new registrations and cleanup on the next Fit.
  Restoring the old gate retains 23 observations immediately after opening.
- Folded title cards cache their expanded footprint across padding and hover notifications.
  Content, available width, font completion and presentation typography invalidate the metrics.
  The count regression delivers twelve resize notifications without another clone, then checks
  content/font/style/width invalidation separately. Restoring the old code clones repeatedly.
- Every context-created parity page awaits its own CDP throttle command before navigation,
  including exported HTML viewers. The regression exports and opens a real viewer and checks
  the configured rate on both targets while each is still at `about:blank`. Restoring per-page
  throttling leaves the viewer's rate absent and fails the regression.

UX review: no new control or blank warning row, no extra delay before checks run, and no viewport
takeover on warning delivery. Warning counts remain discoverable after an interrupted opening.
A harness-only warning override was rejected because it would preserve the race for people.
An async page-event callback alone was rejected because navigation could outrun its CDP command.
No golden was re-recorded. Initial count-test fixtures needed to await selection's own measurement
transaction and change the flex basis to exercise available width; those were corrected without
loosening the assertions. The refreshed skill viewer remains at 1.1.26, one patch above master.

Final verification: six Docker passes on the final fresh bundle alternate three `PARITY_WORKERS=24`
runs with three `PARITY_CPU_THROTTLE=10 PARITY_WORKERS=8` runs. Each passes all 70 tests and checks
all 84 browser goldens unchanged, with no retries. An earlier six-pass matrix also passes unchanged.
Two fresh `pnpm parity` runs each check all 1,769 goldens with zero changed, added, missing or stale.
No update command was run. The full unit suite passes twice: 534 files, 7,201 tests, four existing
skips, no type errors. Production Chromium passes all 138 tests in the five branch-touched e2e
specs plus CSP, then all six repeats of the two count regressions. Explicit ports are 6205–6209;
all servers stop. Build, entry budget (105.7/123.5 kB gzip), skill freshness and i18n pass; existing
translation gaps and warnings remain. Master is still `66583484`, so no further rebase is needed.

## Measurement review follow-up (2026-10-15)

Rebased onto `feca7852`, preserving both documentation histories and regenerating the viewer
from master's template. Plugin 1.1.26 is exactly one patch above master's 1.1.25. Every golden
is byte-for-byte unchanged from `35bdd142`; no update command was run for these review fixes.

- **Command order:** the editor owns the cancellable pending layout. Undo cancels it before
  touching earlier history; edits and replacements invalidate it. Selection alone preserves it.
  The held-ResizeObserver browser regression compares all original node/boundary boxes after Undo
  and release, then checks normal completed-layout Undo/Redo. Removing Undo cancellation fails
  the box comparison. Unit regressions cover Redo, replacement, edits and late readiness delivery.
- **Interrupted fits:** readiness subscribers and the active viewport transition are separate.
  Actual user viewport movement/node drags cancel viewport work, preserving subscribers. The
  real wheel regression interrupts an animation and requests no further fit, then checks pending
  state, zero connected mutation observers and unchanged callback/record counts over 20 frames.
  Disabling interruption fails with pending still true; unit tests cover stale completions,
  preserved subscribers and cancellation between stable samples.
- **Sub-pixel boundaries:** delivered DOM axes that round to zero count as empty, while descendants
  still measure. Imports with width 0.1, height 0.4 and both axes pass opening, Fit and Auto-layout.
  Restoring the exact-zero check fails all three. The parity reader records these boundaries;
  restoring its old check independently fails its three new fractional cases.
- **Delayed Checks:** the held route matches hashed assets and dev TSX URLs, including queries.
  The existing test keeps the card absent until release, then verifies its final fit. Restoring
  the production-only route fails the dev request assertion.

Final verification: a fresh `pnpm parity` compares all 1,769 goldens with zero changed, added,
missing or stale. Six consecutive Docker browser passes alternate three `PARITY_WORKERS=24`
runs with three `PARITY_CPU_THROTTLE=10 PARITY_WORKERS=8` runs: 68 tests and 84 unchanged goldens
per pass, no retries. These reuse the fresh production bundle. Unit tests pass 7,201 with four
existing skips across 534 files (`pnpm test --maxWorkers=2`). Production build and entry budget
pass (105.7/123.5 kB gzip). Production Chromium passes all 136 tests in every touched e2e spec
plus CSP; the final dev fit-settled run passes all 18. Both use explicit ports 6205–6209, and
all servers stop. Skill freshness and i18n pass; existing translation gaps/warnings remain.

Early runs caught a test-fixture omission, invalid void unions and an unnecessary offscreen drag;
these were corrected. The interruption negative control initially passed because the pointer was
still over Fit's button; moving it onto the canvas makes the reverted cleanup fail as intended.
An early four-worker dev run hit Chromium's `ERR_NO_BUFFER_SPACE` at navigation; the final
isolated two-worker run is clean. No timeout or assertion was loosened to cover these failures.
The scoped designer review rejected broad wheel capture because panel/text/embed-page scrolling
is not viewport takeover; actual React Flow move events handle cancellation instead. Undo
cancellation avoids waiting indefinitely behind unavailable measurements. No timing fallback
or golden re-recording was introduced.

## Browser parity integration with master (2026-10-15)

Rebased onto `1486840b` (#115, #118, #117 and #123), retaining both documentation histories,
master's complete autosave/example-copy/CopyNotice flow, and measured fits without timer-driven
opening or Auto-layout fits. The latest master defers exactly the same eight showcase cases;
all are restored. Relative to master, the only golden differences remain the eight additions
and the two Tidy input corrections detailed in "Restoring showcase coverage" below. No golden
was re-recorded during this integration, including after the nested-boundary adaptation.

Auto-layout now indexes the unified element hierarchy and refits children before parents, using
measured cards and annotations and the newly computed child-boundary boxes. Empty boundaries
stay valid and membership is unchanged. Parent-first and child-first unit regressions both fail
when the refit is temporarily reverted. The production browser regression holds ResizeObserver
deliveries across a three-level, initially empty hierarchy, queues Auto-layout then Fit view,
and checks every resulting boundary and an unchanged subsequent fit. The fixture is in the Lab.

The parity reader also accepts explicitly zero-sized boundaries, still recording them and
independently checking descendants. Reverting only that reader change makes its dedicated
regression fail to settle; no assertion or golden output is removed. The task queue and measured
gate need no hierarchy-specific fallback or new timing budget.

### Integration verification

- Eight consecutive Docker browser-tier passes: three with `PARITY_WORKERS=24`, three with
  `PARITY_CPU_THROTTLE=10 PARITY_WORKERS=8`, and two with
  `PARITY_CPU_THROTTLE=4 PARITY_WORKERS=16`. Each passed all 65 tests and compared all 84 browser
  goldens with zero differences, missing or stale records and no retries. The first built fresh;
  repeats reused that production bundle. Production e2e ran alongside much of this stress sweep.
- Two subsequent fresh `pnpm parity` runs each compare all 1,769 goldens with zero changes,
  additions, missing or stale files. No golden was re-recorded during the rebase or verification.
- `pnpm test --maxWorkers=2`: 532 files passed, 7,184 tests passed, four existing skips, no type
  errors. Production build and entry budget pass (105.7/123.5 kB gzip). The released viewer is
  fresh at plugin 1.1.25; `pnpm i18n check` reports zero errors with existing gaps and warnings.
- Production Chromium on explicit ports 6205–6209: all 161 checks pass across fit-settled,
  layout, round13-polish, CSP, examples-picker, zones-boundaries and showcase-examples. The first
  expanded sweep passed 159 and failed two tests that started counting saves or measuring a drag
  before the opening fit settled. Both now await `settledCanvas`; all six focused repeats pass.
  Temporarily restoring the old waits reproduces the nested drag failure in all three repeats.
  The selection race appeared only in the initial full-load run. The waits ensure the existing
  assertions start from the finished opening fit.
- Final lint found six non-null assertions in the new browser regression; explicit checks replace
  them. Its added annotation-membership check compares by id because normalization draws zones
  before notes; the initial order-sensitive assertion failed, and the corrected targeted run passes.

## Autoscaling A2 round 2 review (2026-10-15)

The rebase retained master and A2 code and documentation; no golden was hand-merged. The full
initial check compared 1,854 goldens and found exactly one intended difference from round 1:
`node/i18n/catalogs.json`. Three translated import-report messages add the current selected-boundary
count, explain automatic scaling dependency inclusion, and explain missing-source recovery. This
changes catalog message counts and the `importReport`/`importDetail` area hashes (114 fields).

Only that golden was re-recorded, with `pnpm parity:update --tier node i18n`, after inspecting the
initial full-run difference. All other 1,853 goldens remain unchanged, including every simulation,
planning, import, layout, renderer, native/export and skill output. The performance and transaction
refactors introduce no output changes. The final full verification is recorded in
[the round 2 review](research/autoscaling-a2-round2-review.md).

## Autoscaling A2 verification (2026-10-15)

A2 adds frozen activation, published-cooldown and idle-reader diagrams, a public two-burst Kafka showcase,
and a synthetic Kubernetes controller import. All existing legacy/A1 **diagram-output** goldens remain
unchanged. New goldens cover those inputs through simulation, controller history/explanations, planning,
checks/evidence, agent/native/skill/export paths and the showcase's browser layout.

The update records **93 new goldens** and changes these **seven** existing shared/import goldens
(1,854 total; all other 1,754 are unchanged):

| Golden                             | Reason                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node/agent/tools.json`            | Agent input schemas accept the bounded A2 controller, resource-default provenance, independent resource execution revision and unsupported-controller summaries.        |
| `node/skill/public-schemas.json`   | Hashes and sizes of the generated v2 diagram and v1 ops schemas reflect the same contracts.                                                                             |
| `node/skill/files.json`            | Generated format reference and spec describe the new controller, trigger and import support.                                                                            |
| `node/skill/current-stencils.json` | The new public example changes the generated “Most used in the examples” ordering; stencil definitions are unchanged.                                                   |
| `node/skill/validate.txt`          | Validation transcript includes the three new frozen A2 corpus inputs.                                                                                                   |
| `node/i18n/catalogs.json`          | Eighteen A2 autoscaling/import messages and their translations change the relevant catalog hashes.                                                                      |
| `node/imports/kubernetes.json`     | The existing fixture now carries executable ScaledObject settings, unmeasured resource assumptions and an explicit policy note; its original range summary is retained. |

The initial check found only these intentional differences and absent new-input goldens. Re-recording is
limited to these additions/contracts/import behavior; no legacy/A1 output or existing browser output is
accepted with a changed golden. The eight pre-existing browser measurement deferrals remain deferred.

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

The reader explicitly loads every font face/weight used by rendered text (with its actual characters), then awaits
`document.fonts.ready`. Every React Flow node must have dimensions and be visible (React Flow hides unmeasured
nodes); the app's `data-fit-pending` must be false. Node boxes, edge paths, label placement and the viewport must
agree across rendered frames. A pending fit includes its measurement transaction and viewport animation. Opening
no longer gets a corrective Fit view click: the app's automatic fit uses those same final inputs.

Readiness compares geometry, rather than a node's `innerText`: a live badge or timer can change every frame without
moving anything, making text-based polling never converge. The full text is still returned and compared exactly in
the golden; no text, path, box or viewport value is normalised away. `settle.parity.ts` exercises a badge that changes
every frame and checks that its words are still read. This is not a way to record wall-clock live counters as goldens;
those belong in the seeded Node tier.

Stress options apply inside Docker too: `PARITY_CPU_THROTTLE=10 pnpm parity:browser` uses Chromium's CDP CPU throttle;
`PARITY_WORKERS=40 pnpm parity:browser` increases parallelism. They never change expected output or enable retries.
For repeated ad-hoc runs, use Playwright's `--repeat-each` inside the same image; the parity CLI intentionally rejects
duplicate golden records within one ledger, so full `pnpm parity:browser` stress runs use separate invocations.

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

## Autoscaling A2 import recovery (#125, 2026-10-15)

Only `node/i18n/catalogs.json` changes: the new `importDetail.scalingWorkExhausted` message
raises every catalog's message count from 1,778 to 1,779 and changes its `importDetail` hash.
The 37 untranslated catalogs gain one English fallback (78 to 79); the pseudo-locale's fallback
count remains zero. All other 1,853 goldens retain their output. No diagram, simulation, import,
export or browser golden is re-recorded. Focused tests cover dependency-work exhaustion and exact
completion outside the frozen corpus, including drawable fallback, named recovery reports and
successful reselection. Deliberate reversions also reject repeated closure marking and rebuilding.

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

## Fit timing fixed

Auto-layout used to refit boundaries from `measured ?? defaultSize`, then fit after 60 ms. Opening combined React
Flow's automatic fit, a nodes-initialized fit and an 80 ms mode fit. None ensured that the pane, boundary dimensions,
fonts or expanded floating chrome had finished measuring. The reset row arrived with the later autosave, and a
folded title card could retain its previous expanded footprint. The first-run hint also has a delayed entrance
animation: equal frames during its delay do not mean its final geometry is in place.

Fits now share a signal-driven transaction: the React commit must match the React Flow store; every visible node's
DOM dimensions must match React Flow's measured dimensions; ResizeObserver (border box, including padding
transitions) must have delivered current sizes for the pane, nodes and overlays; used fonts must finish loading;
finite chrome animations must finish; and the geometry
must agree across frames. Auto-layout waits for measurements before moving/refitting boundaries, then requests a
second transaction for the rendered result. The reset row is committed before fitting, and a folded card measures
its expanded footprint in an unpainted copy when its content changes. Opening has one overlay-aware fit instead of
competing automatic/timer fits. Each task's React updates commit synchronously in its frame callback before the
next task can sample; equal frames alone cannot prove a queued React update committed. Viewport animation completion
clears the pending-fit signal. Decorative node animations do not block fitting the chrome. Failed font downloads
settle on measured fallback metrics in the app; the parity reader still requires successful font loading.

`tests/e2e/fit-settled.spec.ts` holds real ResizeObserver notifications while advancing a fake clock past the old
timers, then releases them. With the app fix reverted, all three early-layout repeats size the boundary at 2686 px
instead of 2726 px. All three delayed-chrome repeats reproduce the CI viewport exactly:
`translate(40px, 313.114px) scale(0.379747)`; after pressing Fit view it becomes the golden's
`translate(40px, 332.701px) scale(0.374175)`. The fixed test requires that Fit view leave every drawn value unchanged,
and also exercises opening with delayed measurements/entrance animation. The editor unit test fails with the app
fix reverted too: Auto-layout acts before its measurement callback.

A second init script holds React's `MessageChannel` work queue after opening. Without the commit barrier, two
unchanged frames let a fit run before the queued layout commit: the final node boxes are laid out, but the viewport
remains the opening fit (`0.395349`) until Fit view moves it to `0.374175`. The regression fails before the barrier
and passes in all three repeats with it. Thus the frame comparison supplements commit/measurement signals; it does
not replace them. The font-failure and decorative-animation tests also fail with their fixes removed.

No golden was changed or loosened for this fix.

## Restoring showcase coverage: what changed and why (2026-10-15)

The eight cases deferred by #120 are enabled again. Added opening renders are
`browser/render/{contoso-dmz,shared-api-quotas}.json`; added Auto-layout/Tidy results are
`browser/layout/{contoso-dmz,measured-order-capacity,partitions-vs-subscriptions,serverless-burst-buffer,shared-api-quotas,shared-worker-pool}.json`.
The canvas reader identifies an edge by its nesting, so an id starting with `deny-` is included while the
deny marker inside it is excluded. Opening waits for each file edge by its own test id.

The layout harness had two independent control bugs:

- Ctrl+A was sent with focus on the page body after the Auto-layout palette closed. Selection shortcuts act
  on the canvas, intentionally leaving text fields and toolbar controls alone. Undo selects the elements the
  step changed, not necessarily every element; Ctrl+A outside the canvas left that partial selection intact.
  Palette Select all and Ctrl+A with canvas focus both select every diagram node, boundary and edge. Opening
  the palette preserves that selection. Node selection is read from React Flow's test-id wrappers and their
  `selected` state (React Flow does not expose `aria-selected`); the inspector confirms the combined count.
  Button and keyboard Undo restore the same document and changed-element selection. Keyboard Undo from the
  canvas also follows that selection with focus/pan; the original shortcut ran from the body, so it did neither.
- Auto-layout is already the saved layout in the five small planning showcases. It creates no undo step:
  Ctrl+Z does nothing, and the replacement Undo-button click waited forever on a disabled control. The supplied
  run's trace ends retrying that disabled click, before Select all or Tidy. With a full selection, Tidy is
  offered in all five; no example needs a `tidy: "not offered"` result.

The harness now compares the opening and laid-out node boxes, undoes only a real document change, verifies
the restored boxes, and asserts every node/boundary and edge is selected both before and inside the Tidy
palette. `selection.parity.ts` covers unchanged Auto-layout, Undo's partial selection, body/toolbar versus
canvas Ctrl+A, palette selection preservation, boundary-constrained Tidy, and deny-prefixed edge ids.

A first 24-worker pass then exposed a separate readiness race in the new quota layout: the deferred
architecture-check result adds a warning row, growing the title card from 103 px to 129 px. Auto-layout
sometimes fitted before that row arrived (`scale(1.14674)`) instead of after it (`scale(1.12414)`). Layout
cases now wait for the warning count computed from their public input to appear in `checks-count` before
running Auto-layout; a diagram with zero warnings adds no row to wait for. Opening still records the app's
initial fit, with no corrective Fit click. `checks.parity.ts` holds the actual checks worker's result and
proves that the layout wait stays pending until the row renders, then matches the recorded Auto-layout.
Removing the wait fails that regression. No app behavior or golden changed for this readiness fix.

Only two existing goldens change, solely in their `tidy` records. A diagnostic replay of the original
Ctrl+Z/Ctrl+A sequence matched both old records exactly:

- `browser/layout/aws-fanout.json`: Undo selected the AWS boundary and its 15 changed members, omitting
  unchanged `client` and every edge. The old golden tidied those members alone, keeping the outside client
  fixed and growing the boundary from 2240×632 to 2350×632. Selecting all 16 nodes includes the client and
  its connection to the API. That whole-diagram Tidy cannot satisfy boundary membership, reports
  "Couldn't find room. Nothing moved.", and preserves the saved 2240×632 boundary at 380,0 and original
  node positions. Paths and labels now describe that unchanged drawing. This is an offered, refused Tidy,
  not a missing action.
- `browser/layout/rag-assistant.json`: Undo selected 12 changed nodes, omitting unchanged `user` and every
  edge. The old Tidy excluded `user-to-rag-api` from its layout graph, treating the chat as an obstacle and
  placing the API at 40,250. All 13 nodes now participate, including that incoming connection; the API lands
  at 427,160 and the downstream layers, routes and labels follow the complete graph. The chat remains at
  40,160. No stencil, size or wording changes.

Auto-layout records, all other existing browser records, and the entire Node tier stay unchanged. These
are corrections to harness inputs; the app's selection, history and layout behavior are unchanged.

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

## Autoscaling A1 final verification (2026-10-15)

No golden changes: the CPU/admission and retained-retry corrections apply to failure paths outside
the frozen corpus. Routing and endpoint duration regressions, equivalent real retry workloads at
exact and sampled scales, and the expanded per-step seeded oracle cover these corrections. Each
regression was checked with its fix temporarily removed. The resource-less p3-to-A1 compatibility
test also rejects a deliberately broken upgrade playback path.

The drain sweep, cached interval keys and indexed check targets preserve every existing output;
operation-count regressions reject the old work patterns. The refreshed offline viewer carries the
runtime corrections, while viewer implementation bytes are excluded from its semantic goldens as
before. No output was re-recorded to make a failure pass.

## Autoscaling A1 refusal recovery review (2026-10-15)

### Final review follow-up

Allocation-only preflight replaces full-state rollback checkpoints without changing recorded output.
Operation-count tests reject checkpoints for unrelated edits and bound preflight to three allocation
fields per node regardless of queued messages; the deep-graph regression rejects recursive cloning.
The seeded refusal probe now edits replicas (an allocation input) rather than concurrency, retaining
all no-op and next-step replay assertions. Fixed/overridden readiness completion and two-sided sampled
memory bounds have focused regressions. No golden is re-recorded for these fixes.

### Rebase onto Examples gallery and diagram picker (#118)

Generated skill inputs and the marketplace started from master's files, then `pnpm schemas` and
`pnpm skill:release` regenerated the combined feature set with plugin 1.1.23. Both documentation
histories and both Lab fixtures are retained. Golden conflicts took master's complete files;
none was hand-merged.

The first full parity run found only `node/i18n/catalogs.json` different. `pnpm parity:update`
re-records exactly that catalog summary: master's 1,689 messages become 1,757 in all 38 records
through the 67 A1 messages and the Autoscaling gallery label. Only `admission`, `autoscaling` and
`examples` hashes change. All 37 language catalogs translate the new label; fallback counts remain
unchanged. The gallery's `shows` metadata derives the autoscaling tag from explicit A1 resources
and enabled HPA, rather than vendor icons; this metadata does not alter exported diagrams.

The other five shared metadata goldens already carrying A1 stay unchanged: public schemas retain
the A1 resource/HPA and legacy revision contracts; agent tools carry the same properties; skill
files retain the A1 format/spec and frozen stencil ranking; the current stencil ranking includes
the A1 showcase; validation retains its six additional A1 records. All 127 A1-specific additions
and every simulation, planning, check, trace, layout, import, export and browser golden remain
unchanged. All 1,761 records remain present, including the eight existing browser deferrals.

The pre-rebase run matches all 1,761 goldens, with none changed, added, missing or stale. These
local fixes cover refused runner operations (including slow-motion forecast recovery), occupied concurrency reductions, replacement admission
and staged editor identities outside the frozen corpus. The speech regression is covered by the
production browser suite. Each fix has a failing deliberate-reversion regression. No golden was
re-recorded for these fixes; the refreshed viewer changes implementation bytes only.

### Rebase onto nested boundaries and zones (#115)

Generated conflicts started from master's complete files, then `pnpm schemas` and `pnpm skill:release`
rebuilt the combined contracts and viewer (plugin 1.1.22, one patch above master's 1.1.21). Golden
conflicts took master's files whole; no golden was hand-merged. The first complete parity run found
only `node/skill/public-schemas.json` and `node/i18n/catalogs.json` different, and `pnpm parity:update`
re-recorded exactly those two. All 1,761 records remain present. No diagram-output golden changes,
including every legacy diagram and all six master showcases; the eight existing browser deferrals
remain exactly as recorded above.

Relative to master, the six changed shared goldens are:

- `node/skill/public-schemas.json`: combined schema hashes/sizes retain boundary and annotation parent
  fields and add A1 resources, HPA and revision contracts. V1 and pre-A1 v2 revisions forbid resource
  execution properties; v2 adds `LegacyNodeProps` and `LegacySimulation`. Ops retains A1 property patches.
- `node/agent/tools.json`: agent tool contracts include the same resource/HPA properties and revision.
- `node/i18n/catalogs.json`: 67 A1 English keys add the autoscaling area and increase message counts
  from 1,672 to 1,739 in all 38 records (37 translated languages and the pseudo-locale). Fallback
  counts stay unchanged: the new English-only CPU-budget message is offset by translating the existing
  `admission.invalidNumber` message. Only the admission/autoscaling area hashes change; master's
  edit/chrome messages and the per-message output golden remain intact.
- `node/skill/files.json`: the generated format reference and spec include A1; the frozen stencil
  reference ranks the original examples with the A1 showcase. Other pinned skill files are unchanged.
- `node/skill/current-stencils.json`: the current public stencil ranking includes both master's six
  showcases and the A1 showcase. The legacy aggregate inputs remain frozen.
- `node/skill/validate.txt`: one valid A1 showcase and five valid frozen A1 corpus diagrams add six
  validation records; existing records and invalid-input diagnostics are unchanged.

The 127 A1-specific goldens added earlier in this PR remain unchanged by the rebase and review fixes.
Released viewer and generated application implementation bytes remain outside semantic parity. The
combined build folds the persisted-resource validator into the preloaded `groupHierarchy` chunk;
startup tests pin its presence, keep controllers lazy and preserve the entry size budget.

## Browser fit verification (2026-10-15)

- Twelve full browser-tier passes on the completed fix: ten with 12 workers, one with CDP CPU throttling at 10×
  and 8 workers, and one with 40 workers (the Docker host reports 32 cores). Each checked all 70 browser goldens,
  with zero changes, additions, missing or stale files. The first built production fresh; repeats reused that
  same production bundle. During reproduction work, a full 20× CPU / 4-worker run also matched every golden.
- Two fresh `pnpm parity` passes: 1,425 goldens each, all unchanged. No golden was re-recorded.
- The production e2e fit, layout, polish and CSP specs: 37 passed on ports 6205–6209. The fit regressions also
  passed all 18 tests under `--repeat-each=3`. The reverted app, held React queue and changing-text negative
  controls failed as described above.
- `pnpm test --maxWorkers=2`: 494 test files, 6,366 passed, 4 skipped, no type errors. Earlier runs alongside
  builds/browser stress hit the existing local five-second test timeouts; the isolated run passed without changing
  a timeout or assertion. Production build, entry bundle budget and the released viewer's freshness check passed.

## Restored showcase verification (2026-10-15)

- `pnpm parity:update`: exactly eight added goldens and the two explained Tidy corrections above; no other
  existing output changed. All eight deferred cases now run, with no skips or `not offered` placeholders.
- Six consecutive complete browser-tier passes after the warning-chrome readiness fix: three with
  `PARITY_WORKERS=24`, alternating with three with `PARITY_CPU_THROTTLE=10 PARITY_WORKERS=8`.
  Each passed 62 tests and checked all 82 browser goldens with zero differences and no retries. These reused
  the production bundle made by the update; two subsequent fresh `pnpm parity` runs each checked all 1,642
  goldens unchanged.
- Restoring the old unconditional Undo click, unfocused Ctrl+A and deny-prefix exclusion made all four
  selection/reader regressions fail (disabled Undo, incomplete selection, or the omitted connection).
  Restoring the fixes passed all four. Removing the warning-chrome wait made the held-worker regression
  resolve before its warning row existed; restoring it passed. The first stress attempt exposed that race;
  its viewport difference was fixed without recording it.
- The optional polish sweep exposed two drags starting with `data-fit-pending=true`: no boundary-exit toast
  and an empty box selection. Both now await `settledCanvas` before measuring coordinates. Temporarily removing
  those waits reproduces both failures; restoring them passes both, without changing app behavior.
- `pnpm test --maxWorkers=2`: 498 files passed, 6,477 tests passed, 4 skipped, no type errors. The initial
  post-rebase run had one metadata failure: Vitest's filesystem transform cache still held the 17-example
  registry and pre-showcase globs. `pnpm exec vitest --clearCache` followed by the full run passed all 23
  examples and removed the obsolete-snapshot warnings. Production build, entry size budget (103.9/123.5 kB
  gzip), and skill viewer freshness passed; plugin 1.1.21 remains exactly one patch above origin/master.
- Production e2e on explicit ports 6205–6209 (`VITE_E2E=1` build): 79 passed across fit-settled, layout,
  round13-polish and CSP; no retries. Both servers stopped after the run. `pnpm i18n check` reports no errors;
  existing catalog gaps and translation warnings remain unchanged.
