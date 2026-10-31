# Tutorials curriculum audit and batch plan

## Recommendation and scope

Audit baseline: `5070300ad` (2026-10-30), including the Syllabus and finish handoff
from #398/#399. This is a plan, not an implementation or a claim that new lessons
are already available. No product code or output goldens change.

Keep the six existing chapters and add **VII: Share, present & work together**.
Propose **13 new lessons**, substantive revisions to **33 existing lessons**, and
retain the exercises of the other **16** with shared readability, recovery and
ending improvements. That produces 62 lessons, including the six intentionally
long design studies. Deliver one shared-runtime PR followed by five content PRs
of nine or ten lessons. The runtime PR is the necessary exception to the requested
lesson count: changing progression and adding lessons in the same PR would make
regressions harder to isolate.

The largest gap is the workflow around the diagram: finding and keeping work,
reviewing Checks, using routes, explaining evidence, exporting, collaborating and
reviewing agent changes. Waiting, retries and resilience already have substantial
coverage. Adding another basic retry lesson would have less value than making
existing comparisons easier to understand.

## Evidence and limits

Read the tutorial catalog and its shared factories, English messages, types,
checks, machine, runner, solution resolver, repair/path/configuration code,
sandbox, metadata, coachmarks, TutorialApp and finish handoff. Cross-checked
`tests/e2e/tutorials.spec.ts`, the tutorial unit suites, tutorial release/design/
backlog fragments found with `rg -l tutorial docs`, the release history, roadmap,
simulation specifications, examples documentation and master history since
2026-09-15. Links below are repository-relative and point to implementation rather
than treating old planning documents as proof of shipping.

Runtime evidence on this checkout:

- Started `pnpm dev` on loopback port 6536; the tutorial URL returned HTTP 200.
  Stopped that server after the check.
- Ran the existing **solution plays through the real UI** tests on a production
  E2E build, Chromium, two workers, explicit ports 6530–6534: `mobile-api`,
  `kafka-topic`, `rates-and-inputs`, `threads-block`, `circuit-breaker`,
  `study-cells`. **6 passed (45.7s)**, zero retries. These traverse one lesson in
  each chapter through real controls, check completion and verify no autosave.
- The interactive browser host and native computer-use pipe were unavailable.
  Therefore this is **not a completed manual visual walkthrough**. No screenshots
  or phone/keyboard usability observations are claimed. Ratings are editorial and
  code-based; the six passing paths supply runtime corroboration only. Before
  content implementation, manually walk these six at desktop and phone width,
  light/dark, using Show me, an intentional mistake and Undo. Reserve half a day
  for that review; it may change the proposed ratings and order.

Important corrections to the brief/history:

- Tutorials are now **production features**, not dev-only. See
  [TutorialApp](../../src/tutorials/TutorialApp.tsx),
  [production release](../release-notes/2026-10-25-tutorials.md) and the production
  subpath coverage. The runtime driver and Lab fixtures remain DEV/E2E-only.
- [ids.ts](../../src/tutorials/catalog/ids.ts) and
  [catalog/index.ts](../../src/tutorials/catalog/index.ts) currently expose all
  **49** lessons: Basics 12, Building blocks 10, Simulation basics 7, Waiting &
  threads 6, Resilience 8, Design studies 6. Older quarantine/owner-decision notes
  are historical evidence, not the current availability list. In particular,
  backlog-lag, scale-to-zero, shedding, DLQ and all studies have completed content.
- ROADMAP and early sections of SIMULATION/SIMULATIONS lag later implementations.
  Caller waits and retries execute now; collaboration is more than its early Lab
  proof. Follow the current code and later specification sections.
- The existing [trace-camera follow-up](../backlog/2026-10-30-tutorial-trace-camera-pending.md)
  records an intermittent pending camera in `trace-slowmo`; its focused master
  comparison passed. Do not label that failure proven pre-existing or weaken its
  assertions. This audit's six samples do not include that case.

## Coverage map

**Well** means a useful action plus an observed result, with truthful limitations.
**Stale/partial** means a lesson exists but does not teach the present workflow or
only checks part of its promise; it does not imply a broken selector. **Missing**
means no lesson explicitly teaches the area. Incidental appearance in a large
example does not count as instruction. Subareas are separated where their status
differs.

| User-facing area                                                                                     | Status and current lessons                                                                                                  | Verified implementation; curriculum action                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workbench: rail, flyouts, shared dock, Properties/Checks/AI tabs                                     | Stale/partial: `mobile-api`, `property-sheet`, `annotate` teach individual controls, no shell orientation                   | [ToolRail](../../src/canvas/chrome/ToolRail.tsx), [DockTabs](../../src/canvas/inspector/DockTabs.tsx). Add `workbench-tour`; identify Edit versus Live and dock ownership.                                                                                                                                                     |
| Add/search stencils; quick-add, recent choices, grow and insert                                      | Well: `mobile-api`, `quick-add`, `insert-on-edge`; partial full Stencils library                                            | [stencils](../../src/stencils/registry.ts), [placement](../../src/canvas/placement/useRailPlacement.ts). Add library reuse, enhance search fallback and explain inferred defaults; no lesson per vendor icon.                                                                                                                  |
| Connect, sides, reconnect; Request versus Message                                                    | Well: `dots-and-sides`, `request-vs-message`                                                                                | [drawing contracts](../UX-PRINCIPLES.md), [edge defaults](../../src/stencils/edgeKind.ts). Keep meaning and continuity assertions; add keyboard alternatives.                                                                                                                                                                  |
| Label, subtitle, Markdown description                                                                | Well in Edit: `property-sheet`; stale/partial Live route in several lessons                                                 | [NodePanel](../../src/canvas/inspector/NodePanel.tsx), [Live dock](../../src/live/DockedLive.tsx). Workbench puts readouts before collapsed Edit properties; retain/use `livePropertiesGoal` and the disclosure action, not an assumption that double-click exposes settings immediately.                                      |
| Selection, pan/zoom, Fit, precision, copies, Undo/Redo, bulk edit                                    | Partial: `arrange`, `boundaries`, `quick-add`; no integrated navigation/reuse practice                                      | [CanvasControls](../../src/canvas/chrome/CanvasControls.tsx), [MultiPanel](../../src/canvas/inspector/MultiPanel.tsx). `workbench-tour` and `library-reuse`; enrich shortcuts in existing hints without a shortcuts-only chapter.                                                                                              |
| Boundaries, nesting, membership, zones, shapes, colours                                              | Well for first boundary/zone: `boundaries`, `annotate`; partial nesting, shape and style                                    | [GroupPanel](../../src/canvas/inspector/GroupPanel.tsx), [AnnotationPanel](../../src/canvas/inspector/AnnotationPanel.tsx). Add shape/style practice to annotate; optional nested-boundary challenge; explain visual zone versus member boundary.                                                                              |
| Dependencies, config settings, secrets and visibility pips                                           | Well: `dependencies`, `dependencies-2`                                                                                      | [relations](../../src/model/relations.ts). Retain no-traffic distinction and generic setting names; extend hints to other dependency kinds without inventing outage execution.                                                                                                                                                 |
| Command palette, find/select and keyboard discovery                                                  | Partial: `command-palette` teaches Add and Go to, not action search                                                         | [palette](../../src/palette/CommandPalette.tsx). Add an actual command and its effect; Ctrl+K is a discovery route throughout the curriculum.                                                                                                                                                                                  |
| Your diagrams, example copies, gallery features, saves, device/cloud provenance                      | Missing as a workflow; finish Save a copy is incidental                                                                     | [LibraryDialog](../../src/components/LibraryDialog.tsx), [diagramIO](../../src/lib/diagramIO.ts), [StorageDialog](../../src/interop/ui/StorageDialog.tsx). Add `library-reuse`; configured cloud providers are optional, no login required to graduate.                                                                        |
| Open/import: native, Mermaid, draw.io, Compose, AsyncAPI, Kubernetes, Terraform; import reports      | Missing                                                                                                                     | [formats](../../src/interop/formats.ts), [ImportReportDialog](../../src/interop/ui/ImportReportDialog.tsx). Add `import-and-review`; demonstrate one small Compose fixture, name other supported formats accurately.                                                                                                           |
| Architecture Checks, fixes/ignore and Run simulations evidence                                       | Missing: `capacity` uses the bottleneck's Apply fix, which is a different workflow                                          | [ChecksCard](../../src/checks/ui/ChecksCard.tsx), [checks](../../src/checks/index.ts), [headless runs](../SIMULATIONS.md#played-headless-run-simulations). Add `checks-and-fixes`; retain the distinction between static findings and simulated evidence.                                                                      |
| Sources, rates, Free play, injection, Traffic × / Capacity ×, dot scale                              | Partial: `rates-and-inputs`, `load-shedding`, `capacity`                                                                    | [capacity inputs](../../src/live/session/useCapacityInputs.ts), [ControlBar](../../src/live/ControlBar.tsx). Rate lesson edits source rate then uses a saved profile that separately defines 6/s; make that provenance explicit. Teach scale as requests/dot, not extra traffic.                                               |
| Readouts, health, backlog/lag, events, live dock vitals                                              | Well core: `read-a-node`, `backlog-lag`, `capacity`; partial new dock                                                       | [DockedLive](../../src/live/DockedLive.tsx), [observed trouble](../../src/live/observedTrouble.ts). Teach waiting versus failure, selection versus hover, and how to open Edit properties.                                                                                                                                     |
| Camera preserved on entering Live; Overview/Focus/Following/Custom                                   | Missing explicit instruction; stale implication in `trace-slowmo` that slow motion always owns camera                       | [ViewMenu](../../src/live/ViewMenu.tsx), [camera policy](../../src/canvas/camera/panePolicy.ts), [slowmo controller](../../src/live/slowmo/controller.ts). User pans can take ownership; add one controlled Follow/Custom demonstration, not automatic repeated refits.                                                        |
| Low-zoom chips, hairline connections, zone trouble pills and focus                                   | Missing; studies use large examples without teaching navigation                                                             | [low zoom](../../src/canvas/lowZoom.ts), [FrameDetail](../../src/canvas/FrameDetail.tsx), [browser coverage](../../tests/e2e/lowzoom-chips.spec.ts). Add a troubleshooting/navigation moment to study-cells and workbench-tour. These are display tiers, not a new simulation model.                                           |
| Trace, slowest/dead-letter trace, Sequence, slow motion and hop controls                             | Partial: `trace-slowmo`, `outbox`; Sequence/export not taught                                                               | [TraceCard](../../src/live/TraceCard.tsx), [SequenceDialog](../../src/live/SequenceDialog.tsx), [slowmo](../../src/live/slowmo/controller.ts). Add `sequence-evidence`; enhance existing slow-motion lesson's controls and exit.                                                                                               |
| Saved runs, narration, expectations, scrub/replay, traffic shapes and authoring                      | Well consumption: `saved-simulations`, `webhooks`, `outbox`; partial authoring: `author-a-drill` saves one preset           | [SimPanel](../../src/live/SimPanel.tsx), [runner](../../src/sim/simulation.ts). Add `author-a-simulation`; include when an expectation is evaluated and Run draft versus Save.                                                                                                                                                 |
| Latency p50/p95/p99, waiting versus working                                                          | Well: `where-time-goes`; advanced application `study-rag`                                                                   | [latency](../../src/sim/latency.ts), [NodeDetailSections](../../src/live/NodeDetailSections.tsx). Enhance with one prediction and a minimum-sample caveat; these are sampled model estimates, not production measurements.                                                                                                     |
| Blocking/non-blocking waits, threads, pools, deadlines and late work                                 | Well: `threads-block`, `timeouts-pools`; applied in studies                                                                 | [CallWaitFields](../../src/canvas/inspector/CallWaitFields.tsx), [wait semantics](../SIMULATION.md#requests-that-wait). Strengthen why and distinguish a Message from a non-blocking Request; do not imply timeout cancels the callee.                                                                                         |
| Replicas, resources, planning families, demand/capacity explanations, scenario sizing                | Partial: `load-balancer`, `capacity`, `autoscaling`, studies; no resource/assumption lesson                                 | [NodePlanning](../../src/planning/NodePlanning.tsx), [ResourceDetails](../../src/planning/ResourceDetails.tsx), [scalingPlanner](../../src/sim/scalingPlanner.ts). Add `resource-headroom`; mention unknown limits and model revisions.                                                                                        |
| HPA CPU/busy threads, KEDA lag/queue signals, cloud adapters, cold starts/draining                   | Well narrow comparisons: `autoscaling`, `scale-to-zero`; missing backlog-signal setup and adapter discovery                 | [AutoscalingFields](../../src/planning/AutoscalingFields.tsx), [CloudScalerFields](../../src/planning/CloudScalerFields.tsx), [autoscaling model](../../src/model/autoscaling.ts). Add `scale-on-backlog`; contrast HPA/KEDA/cloud presets in autoscaling, not seven vendor lessons.                                           |
| HTTP addresses, ordered routes, traffic mixes, filters, 404/429 and per-route colours/markers        | Missing: `api-gateway` distributes traffic but explicitly defers address-based routing                                      | [RoutingFields](../../src/planning/RoutingFields.tsx), [route matcher](../../src/sim/routeMatching.ts). Add `route-by-address`; do not promise unsupported regex, rewrites or arbitrary failover.                                                                                                                              |
| Broker groups, queues/logs, partitions, prefetch, filtering/emits                                    | Well basics: `kafka-topic`, `queue-workers`, `partitions`, `fanout`; partial prefetch/type transformation                   | [MessageFields](../../src/canvas/inspector/MessageFields.tsx), [broker topology](../../src/sim/topology.ts). Improve differences and filters in existing lessons; advanced prefetch/emits can be optional hints, not new mandatory lessons.                                                                                    |
| Cache, webhook buffering, outbox/saga, durable recovery                                              | Well illustrative coverage: `cache-aside`, `webhooks`, `outbox`, checkout/payments studies                                  | Catalog correctly says shares approximate cache hit ratio and outbox atomicity is a real-system responsibility. Keep these limitations in goals/endings, not hidden only in advanced docs.                                                                                                                                     |
| Retries, jitter, budgets, idempotency, breakers, rate/shared quotas, shedding, health checks, DLQs   | Well: all eight Resilience lessons and studies                                                                              | [BreakerFields](../../src/canvas/inspector/BreakerFields.tsx), [QueueFields](../../src/canvas/inspector/QueueFields.tsx), [AdmissionFields](../../src/planning/AdmissionFields.tsx). Deepen compare/predict/observe; no additional retry primer. DLQ replay remains a real-world decision, not an app action.                  |
| Node/boundary faults, slowdown, injected errors, cross-boundary cuts and saved drills                | Partial: `faults` only node down/restore; `author-a-drill` only Slow dependency; `health-checks`, study-cells apply outages | [fault model](../../src/model/faults.ts), [Live menus](../../src/live/session/useLiveContextMenu.ts), SimPanel. Broaden drill authoring with optional second preset, explicit restore and outcome; zone outage preset targets a boundary, not an annotation zone.                                                              |
| Network device families, transit latency, allow/deny rules                                           | Missing                                                                                                                     | [network stencils](../../src/stencils/netDevices.ts), [network semantics](../SIMULATION.md#network-devices), [NodePlanning](../../src/planning/NodePlanning.tsx). Add `network-policy`, using modelled allow/deny rather than claiming packet-accurate vendor emulation.                                                       |
| Present, SVG/PNG, recording, Interactive HTML, editable exports                                      | Partial: `share-present` enters/exits Present and opens Share only                                                          | [image export](../../src/interop/image.ts), [HTML export](../../src/export/exportHtml.ts), [recording](../../src/live/record/recordModel.ts), [formats](../../src/interop/formats.ts). Add `export-for-audience`; enhance Present lesson with a readable story and output distinctions.                                        |
| Sharing, password files/links, embeds, Private and privacy consequences                              | Partial: `share-present` checks only `sharing: true`, not a privacy choice                                                  | [ShareChooser](../../src/interop/ui/ShareChooser.tsx), [privacy policy](../../src/lib/localOnly.ts). New output lesson explains audience; do not require a public link or embed deployment.                                                                                                                                    |
| Edit together, roles, join consent, Watch Live together, leaving/recovery                            | Missing                                                                                                                     | [room](../../src/collab/room), [live share](../../src/collab/room/liveShare.ts), [room UI tests](../../tests/e2e/collab-room.spec.ts). Add conditional `work-together`; availability depends on build/transport configuration. Browser editing can use external rendezvous/relay services; do not call it universally offline. |
| AI dock, agent/WebMCP tools, skill installation, turns/Undo/Revert, manual Advanced, on-device model | Missing; RAG study models a system, not the AI editing workflow                                                             | [AiPanel](../../src/ai/ui/AiPanel.tsx), [HowTo](../../src/ai/ui/HowTo.tsx), [WebMCP](../../src/ai/webmcp), [AI tests](../../tests/e2e/ai-howto.spec.ts). Add `review-agent-changes`, deterministic manual reply path; optional agent/model capability, no mandatory account or model download.                                 |
| Languages, theme, accessibility and phone controls                                                   | No dedicated lesson needed; incomplete completion evidence across catalog                                                   | [i18n](../I18N.md), [ToolRail](../../src/canvas/chrome/ToolRail.tsx), [dock tabs](../../src/canvas/inspector/DockTabs.tsx). Teach via every lesson and hints, not a settings tour.                                                                                                                                             |
| Syllabus progress, seals, reset, practice isolation and finish handoff                               | Well implemented, not curriculum material to reteach                                                                        | [seals](../../src/tutorials/seals.ts), [handoff](../../src/tutorials/FinishHandoff.tsx), [progress](../../src/tutorials/progress.ts). Preserve unrestricted lesson choice, explicit saving and retained earned seals through catalog expansion.                                                                                |

## Existing lesson experience review

Scores are **C/P/G/F/W**: clarity, pacing, step granularity, feedback/checks and
showing why. 1 = obstructive/missing, 2 = weak, 3 = serviceable, 4 = strong,
5 = exemplary. They are provisional editorial ratings, not measured learner
success. Minutes below are the authored estimates, not timings from automated
playback. Every ID links to its source. **Revise** means substantive work in the
content batches; **retain** means keep the exercise and its tests while applying
the shared improvements and the smaller notes here.

### I. Basics: drawing

| Lesson (minutes)                                                                      | C/P/G/F/W | Concrete improvement                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [mobile-api](../../src/tutorials/catalog/mobileApi.ts) (3), revise                    | 4/3/3/4/4 | The + already connects, so `connect` can be satisfied before it becomes current. Make either independent placement plus a real connection, or explicitly teach automatic connection and remove the redundant drag. End on what the learner proved, then an optional bigger example. Runtime sample passed. |
| [quick-add](../../src/tutorials/catalog/quickAdd.ts) (2), revise                      | 4/4/4/4/3 | Short but useful; add an unassisted search once rather than always prefiltering. `grow-db` completion/finish mentions Alt+Shift+arrow copying without practicing it: move that hint to library reuse or add a small optional copy.                                                                         |
| [dots-and-sides](../../src/tutorials/catalog/dotsAndSides.ts) (3), revise             | 4/4/4/4/4 | Show why choosing a side clarifies a crowded diagram. Provide a keyboard connection/reconnect route or identify the product capability gap; a test using drag does not prove keyboard access. Verify label/settings survive reconnect, not just the new endpoints.                                         |
| [insert-on-edge](../../src/tutorials/catalog/insertOnEdge.ts) (2), retain             | 4/4/4/5/4 | Useful micro-lesson, not inherently too short. Hint must say to type in the searchable Insert submenu: root quick-add guides do not populate it. Retain bypass removal and half-built repair tests; optional Undo demonstrates preservation.                                                               |
| [property-sheet](../../src/tutorials/catalog/propertySheet.ts) (2), revise            | 4/4/4/4/3 | Use the visible word Properties consistently; distinguish Edit Label from Live readings/Edit properties. Ask for a meaningful responsibility, not just any nonempty description; the check can remain permissive. End by viewing the documented card.                                                      |
| [request-vs-message](../../src/tutorials/catalog/requestVsMessage.ts) (2), retain     | 4/3/3/3/4 | Five steps and two waits are dense for two minutes. Say three minutes. Predict the caller effect before flipping; `watch-api` uses total processed, so it need not prove fresh post-change work. Use a new-run/delta assertion if strengthening that promise.                                              |
| [boundaries](../../src/tutorials/catalog/boundaries.ts) (3), retain                   | 4/4/4/3/4 | Fit to contents is acknowledged rather than geometrically checked. Keep Done as reading confirmation, but don't claim it proves the fit. Add a hint about membership on drop and an optional nested-boundary challenge.                                                                                    |
| [annotate](../../src/tutorials/catalog/annotate.ts) (3), revise                       | 4/4/4/3/4 | Counts prove an annotation exists, not that its words explain anything. Show text versus note versus zone, then optional Shape/colour; keep one concept per required step. Confirm typed drafts survive Skip, correct completion keys and tip placement above the phone dock.                              |
| [dependencies](../../src/tutorials/catalog/dependencies.ts) (3), retain               | 5/3/4/4/4 | Only draw/hide: add a short observation of the remaining dependency pip and say hidden is not deleted. An optional Live observation reinforces no traffic without extending the required path.                                                                                                             |
| [arrange](../../src/tutorials/catalog/arrange.ts) (3), retain                         | 4/4/4/3/4 | Tidy uses Done, so completion does not establish layout quality. Keep that honest and show before/after intent. Supply keyboard multi-selection/menu guidance; keep alignment based on geometry, never elapsed time.                                                                                       |
| [command-palette](../../src/tutorials/catalog/commandPalette.ts) (2), revise          | 4/3/4/4/3 | Two steps teach stencils/nodes but title promises everything. Add one real action search with a visible result and explain context-sensitive availability. Avoid forcing a selection solely to stop a later step completing early.                                                                         |
| [share-present](../../src/tutorials/catalog/sharePresent.ts) (2), revise, move to VII | 3/3/4/2/4 | Three steps end as soon as Share opens; private sharing is described, not performed. Retitle around presenting and choosing an audience; seed a connected story instead of two disconnected services. Teach Present/return, then hand off to export-for-audience.                                          |

### II. Building blocks

| Lesson (minutes)                                                           | C/P/G/F/W | Concrete improvement                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [api-gateway](../../src/tutorials/catalog/apiGateway.ts) (4), revise       | 4/3/3/4/4 | Add/pick/name/connect repeated for two services is busy. Keep the first construction explicit, make the second a small independent task. State early that this distributes, while route-by-address chooses by address.                                   |
| [kafka-topic](../../src/tutorials/catalog/kafkaTopic.ts) (4), revise       | 4/4/4/4/5 | Strong why: separate groups each receive the stream. Show group identity in Properties and contrast the next queue lesson; total counts alone do not teach the distinction. Runtime sample passed.                                                       |
| [queue-workers](../../src/tutorials/catalog/queueWorkers.ts) (3), revise   | 4/4/4/5/5 | Keep the conservation comparison. Ask for a prediction before adding worker two; explain in-flight work when comparing deliveries with completions so learners do not expect equality at every instant.                                                  |
| [load-balancer](../../src/tutorials/catalog/loadBalancer.ts) (3), retain   | 4/4/4/5/4 | Good fresh-progress delta and honest count-reduction model. Move the caveat before the action too: lowering replicas is capacity loss, not taking down an individual replica.                                                                            |
| [cache-aside](../../src/tutorials/catalog/cacheAside.ts) (3), revise       | 4/3/3/4/5 | Share editing is two independent settings in one step. Split setting versus observing, or provide a compact checklist. Keep the explicit approximation caveat: this is not correlated cache-hit/miss execution.                                          |
| [webhooks](../../src/tutorials/catalog/webhooks.ts) (3), retain            | 4/4/4/4/3 | Mostly a saved-run consumption lesson. Strengthen why the queue parks work and what protects the sender; ask what should happen before Continue. Keep the actual expectation rather than a colour-only instruction.                                      |
| [fanout](../../src/tutorials/catalog/fanout.ts) (3), retain                | 4/3/3/4/4 | Filtering follows an outage but the last check proves filter configuration only. Say that explicitly, and add an optional rerun showing which Message reaches SMS. Do not imply the filter fixed the provider outage.                                    |
| [partitions](../../src/tutorials/catalog/partitions.ts) (3), revise        | 3/3/3/3/4 | Learner sets six, then the named comparison supplies eight; the current copy admits this, but it weakens agency. Run the learner's edited configuration or explicitly compare six versus eight. Preserve idle consumers until the learner has read them. |
| [outbox](../../src/tutorials/catalog/outbox.ts) (3), revise                | 4/3/3/3/4 | Two acknowledgments are legitimate reading gates but don't prove transactional semantics. Make the compensation point visible before Done, explain the outbox atomicity assumption and show which evidence is simulated versus narrated.                 |
| [dependencies-2](../../src/tutorials/catalog/dependencies2.ts) (2), retain | 4/4/4/5/4 | Clear small exercise with robust keyed-path checks. Keep hidden-dependency and inserted-row tests; use a harmless setting name and say no secret value is stored.                                                                                        |

### III. Simulation basics

| Lesson (minutes)                                                                 | C/P/G/F/W | Concrete improvement                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [rates-and-inputs](../../src/tutorials/catalog/ratesAndInputs.ts) (3), revise    | 3/4/4/4/4 | Clarify Free play uses source Rate; Practice traffic has its own 6/s profile. Teach ×3 versus sampling Scale separately and read the resulting offered rate, not only cumulative processed. Runtime sample passed.                                              |
| [read-a-node](../../src/tutorials/catalog/readANode.ts) (3), revise              | 4/3/4/3/3 | Opening readout/events is not interpretation. Ask the learner to identify waiting versus work, then choose one event. Add the selected-node dock path and keyboard readout route; avoid telling someone to hover a card suppressed by its open Properties dock. |
| [capacity](../../src/tutorials/catalog/capacity.ts) (3), revise                  | 4/4/4/4/5 | Strong problem/fix/drain structure. Distinguish steady-state estimate from observed backlog and from Checks. Show which replica count changes and why the estimate is an assumption, not measured capacity.                                                     |
| [trace-slowmo](../../src/tutorials/catalog/traceSlowmo.ts) (3), revise           | 4/3/3/3/3 | Only start/run-to-end: learner can wait passively. Add pause/hop/escape and explain live is frozen; camera can become Custom after a manual pan. Sequence is a separate new lesson. Keep the pending-camera follow-up visible.                                  |
| [saved-simulations](../../src/tutorials/catalog/savedSimulations.ts) (3), revise | 4/4/4/4/4 | Good narration/Continue contract. Explain when goodput is evaluated and why either met/failed is evidence; finish with one specific conclusion, not only a list of controls.                                                                                    |
| [faults](../../src/tutorials/catalog/faults.ts) (3), retain                      | 4/4/4/5/4 | Title is broader than node outage/restore. Call it a first Fault; describe slowdown/error/link as next experiments. Preserve restore-only-the-outage behavior under an additional slowdown.                                                                     |
| [author-a-drill](../../src/tutorials/catalog/authorADrill.ts) (3), revise        | 4/3/3/3/4 | Saves one preset and checks that the saved run starts, not its eventual effect. Add target/time confirmation and visible fault outcome, then an optional restore. Keep it distinct from the general traffic/expectation authoring lesson.                       |

### IV. Waiting & threads

| Lesson (minutes)                                                            | C/P/G/F/W | Concrete improvement                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [where-time-goes](../../src/tutorials/catalog/whereTimeGoes.ts) (4), revise | 4/4/4/4/5 | Strong waiting/work explanation and explicit final reading gate. Add a prediction and p50/p95/p99/sample caveat; check the breakdown can be read by keyboard without forcing the mouse hover path.                                                                        |
| [threads-block](../../src/tutorials/catalog/threadsBlock.ts) (4), revise    | 4/3/4/5/5 | Separate Live exit, connection edit, re-entry and comparison are mechanically long but necessary. Give a compact before/after statement at each transition; never merge non-blocking Request with Message. Runtime sample passed.                                         |
| [timeouts-pools](../../src/tutorials/catalog/timeoutsPools.ts) (5), revise  | 4/2/3/4/5 | Upper-length outlier among short lessons: two settings, several Live transitions, three runs. Keep five minutes only after manual timing; use two visible phases with a recap, or trim repeated navigation. Add the late-work caveat before interpreting timeout success. |
| [backlog-lag](../../src/tutorials/catalog/backlogLag.ts) (3), retain        | 5/4/4/5/5 | Current lesson correctly starts with no consumer, uses Trouble's Add a consumer and states that adding topology restarts Live. Keep that explanation and verify new-run progress, not a false claim that the old backlog drained.                                         |
| [autoscaling](../../src/tutorials/catalog/autoscaling.ts) (5), revise       | 4/3/3/4/5 | Good CPU-versus-busy-thread why; expand to metric/target/min/max discovery and real Starting/Ready distinctions. Pair with backlog scaling; vendor preset names do not imply identical controller semantics.                                                              |
| [scale-to-zero](../../src/tutorials/catalog/scaleToZero.ts) (4), revise     | 4/4/4/4/5 | Current cold-start check is `fleet.starting`, held by a paused note, not a nonexistent cold-start counter. State that and connect startup waiting to the warm-minimum tradeoff. Avoid suggesting serverless instant-admission mode models cold starts.                    |

### V. Resilience

| Lesson (minutes)                                                                | C/P/G/F/W | Concrete improvement                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [retry-storm](../../src/tutorials/catalog/retryStorm.ts) (4), retain            | 4/4/4/4/5 | Good negative outcome. Ask why healthy CPU need not mean healthy backlog; define Failed as attempts and carry the specific comparison into backoff-budget.                                                                        |
| [backoff-budget](../../src/tutorials/catalog/backoffBudget.ts) (4), revise      | 4/2/3/5/5 | Six steps, two settings and two end-of-run waits can feel long. Keep same seed, display a two-run comparison and label jitter as supplied by the saved run. Let the learner inspect the failed expectation before moving on.      |
| [circuit-breaker](../../src/tutorials/catalog/circuitBreaker.ts) (4), revise    | 4/3/4/4/5 | Open/Testing can be transient; provide a narrated reading pause or replayable state evidence, not larger timeouts. Explain what each state admits and show the recovered outcome. Runtime sample passed.                          |
| [rate-limit](../../src/tutorials/catalog/rateLimit.ts) (4), retain              | 5/4/4/5/5 | Keep the real quota editor and rejected-count check. Explain burst credit means an instantaneous count need not equal exactly ten; retain separate 429/rejected vocabulary.                                                       |
| [shared-api-quotas](../../src/tutorials/catalog/sharedApiQuotas.ts) (3), retain | 4/3/4/5/5 | Excellent shared-versus-independent contrast, but two models plus payments is dense. State units beside each budget and keep fictional token numbers visibly assumptions. Optional advanced path can inspect configuration.       |
| [load-shedding](../../src/tutorials/catalog/loadShedding.ts) (4), retain        | 4/4/4/5/5 | Strong repeated spike and fresh Shed delta. Keep queued versus in-flight separate; queue limit ten does not mean at most ten total requests in the service. End on bounded waiting, not universal zero failure.                   |
| [dead-letters](../../src/tutorials/catalog/deadLetters.ts) (4), revise          | 4/3/4/3/5 | The final Plan a replay is an acknowledgment and honestly says replay is unavailable. Keep that; add a dead-letter trace/investigation moment and observe the configured delivery limit on a rerun rather than ending at an edit. |
| [health-checks](../../src/tutorials/catalog/healthChecks.ts) (3), retain        | 5/4/4/5/5 | Strong seeded A/B comparison with surviving-zone work and bounded drops. Explain remaining capacity still matters and that health checks do not replicate state.                                                                  |

### VI. Design studies

These are 20–25-minute capstones, not broken three-minute lessons. Their two or
three milestones are intentionally broad, and coachmarks appear only after Show
me. Keep that autonomy; add a prerequisite recap, optional subtask checklist and
an explicit evidence review between milestones. Do not split each into a PR.

| Lesson (minutes), all revise                                        | C/P/G/F/W | Concrete improvement                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [study-checkout](../../src/tutorials/catalog/studyCheckout.ts) (20) | 4/3/2/5/5 | Tenfold load, outbox and partner pool are three substantial tasks. Show offered load and quota together; preserve authored ×10 during Skip/Continue. End with an actual comparison of learner assumptions to the reference.             |
| [study-dispatch](../../src/tutorials/catalog/studyDispatch.ts) (20) | 4/3/3/5/5 | Only two milestones can look deceptively short. Add optional intermediate checks for effective replicas/partitions and make the new saved-run setup explicit. Explain partition ceiling before asking for a larger fleet.               |
| [study-payments](../../src/tutorials/catalog/studyPayments.ts) (25) | 4/3/2/5/5 | Outbox, idempotency, timeout, breaker and poison path are a lot. Offer a task list and clarify idempotency is a model declaration, not proof of no double charge. Preserve unsaved/suspended draft repair coverage.                     |
| [study-fanout](../../src/tutorials/catalog/studyFanout.ts) (25)     | 4/2/2/5/5 | Constructing three main queues, three DLQs and settings in one milestone is the clearest granularity outlier. Use a channel checklist and reusable first-channel example; retain all-channel outcome checks and channel isolation.      |
| [study-rag](../../src/tutorials/catalog/studyRag.ts) (20)           | 4/3/3/5/5 | Keep explicit independent-share approximation and minimum throughput guards on p95. Separate budget, approximate cache and reindexing evidence; distinguish model throughput from answer quality and the AI editor itself.              |
| [study-cells](../../src/tutorials/catalog/studyCells.ts) (25)       | 4/3/2/5/5 | Region/cell construction and evacuation are large milestones. Add a map-reading moment for chips/trouble pills, then close-up evidence per cell; retain no-neighbour-failure and spare-region processing checks. Runtime sample passed. |

### Findings to carry into implementation

No wrong selector was demonstrated by the six sampled paths. Do not file a blanket
“Workbench broke tutorials” fix: many selectors were deliberately retained and
`livePropertiesGoal` already adapts several lessons. The concrete stale assumptions
are **surface ownership and discoverability**, the `trace-slowmo` camera statement,
and promises stronger than their checks (`share-present`, action search, Sequence).

Coachmark risks established by source: first visible target wins; a large node
target can win while the useful setting is hidden; modal dialogs suppress targets
underneath them; tip width is 220 px with no full measured bottom-edge collision
solver. A multiline tip near the footer/phone dock can overflow. This is a risk to
visually verify, not a screenshot-confirmed defect in every lesson.

The weak ending is often the **learning recap**, not the new navigation. The
handoff already has next-lesson summary, steps, dates, seals and accessible Start.
The completed step strip already displays `tutorial.finish.text`; the handoff's
main body focuses on the next lesson. Consider co-locating the conclusion with
the handoff, without duplicating announcements or hiding it behind next-lesson
detail. This is an editorial hierarchy improvement, not a missing-finish-text bug.
Do not rebuild the hub or add another confirmation dialog.

## Proposed curriculum and new lesson specifications

Preserve existing IDs and chapter order, except move share-present into VII.
Within chapters use this final order (new IDs in bold):

- I: **workbench-tour**, mobile-api, quick-add, dots-and-sides, insert-on-edge,
  property-sheet, request-vs-message, boundaries, annotate, dependencies, arrange,
  command-palette, **library-reuse**, **import-and-review**. 14 lessons.
- II: api-gateway, **route-by-address**, kafka-topic, queue-workers, load-balancer,
  cache-aside, webhooks, fanout, partitions, outbox, dependencies-2,
  **network-policy**, **checks-and-fixes**. 13 lessons.
- III: rates-and-inputs, read-a-node, capacity, **resource-headroom**, trace-slowmo,
  **sequence-evidence**, saved-simulations, **author-a-simulation**, faults,
  author-a-drill. 10 lessons.
- IV: where-time-goes, threads-block, timeouts-pools, backlog-lag, autoscaling,
  **scale-on-backlog**, scale-to-zero. 7 lessons.
- V: retry-storm, backoff-budget, circuit-breaker, rate-limit, shared-api-quotas,
  load-shedding, dead-letters, health-checks. 8 lessons.
- VI: retain the six studies in their current order. 6 lessons.
- VII: share-present, **export-for-audience**, **work-together**,
  **review-agent-changes**. 4 lessons.

The seventh chapter puts an optional team/output workflow after the architecture
curriculum without making account, agent or network access a prerequisite for
design studies. Discovery and handoff stay unlocked. A new chapter needs an
exhaustive chapter/seal descriptor and a decision about the whole-syllabus seal;
do not rely on parallel array positions. Existing earned seals keep their dates.

All new lessons target **3–5 minutes including reading**, not counting optional
external setup. Steps below are required steps, each followed by its completion
contract. “Existing” refers to the current Check union; “new observation” is work
for PR 1, not an already available API. New observations must come from semantic
application controllers/events, never arbitrary DOM text or counting button
clicks. Acknowledgment is valid only for a reading/decision step.

### workbench-tour — Find your way around

**I.1 · 3 minutes.** Find tools, read a service and control the view before drawing.
Use a small invented Client → Bookings API → DB practice diagram plus a distant
worker inside a boundary; no external example required.

1. Select Bookings API and open Properties. Check selection plus new dock-tab
   observation (`properties`); explain selection changes what Properties shows.
2. Open Add, find a Service and close the flyout without adding it. Check new
   tool-surface/search observation; demonstrate no accidental edit.
3. Go Live and read the selected service's vitals. Existing `live` plus a new
   semantic node-details observation that accepts dock or floating readout.
4. Use Overview, then Focus; enter Following and return to Custom by a deliberate
   pan (keyboard alternative via camera controls). Check camera mode transitions
   through the controller; no exact pixel or absolute-time condition. Explain
   Live preserves the current view until an explicit view action.

### library-reuse — Keep and reuse a diagram

**I.13 · 4 minutes.** Distinguish an example, practice copy and owned diagram.
Use an invented two-service Status page seed and a gallery preview of public
`kafka-order-pipeline`.

1. Open the gallery and filter to a feature, then cancel. New gallery observation
   records a displayed matching public result; no model change required.
2. Add a service from Stencils, duplicate it and rename the copy. Existing node,
   distinct-subject and label checks; keyboard path Ctrl+K/Ctrl+D/F2.
3. Undo and redo the duplication. Semantic history observation plus final distinct
   nodes; prove an edit was actually reversed/restored.
4. Explicitly Save a copy, then find that copy in Your diagrams. New successful
   copy/owned-entry observation; this is the deliberate exception to no-save
   tutorial tests, scoped to a disposable browser profile. Stay in the tutorial
   until completion; opening the owned copy is an optional final handoff.

### import-and-review — Review what an import inferred

**I.14 · 4 minutes.** Import a small Compose system and inspect guesses before
trusting the diagram. Ship a public invented `tutorial-status-compose.yaml`
fixture with API, worker and Redis; do not ask for a learner's infrastructure file.

1. Download the supplied fixture and open it through File. Check the normal import
   pipeline accepted `compose`; file input needs a keyboard-accessible route.
2. Read the import report's inferred connections and omitted/unsupported items.
   New report observation plus explicit Done for reading; do not claim reading
   establishes the guesses are correct.
3. Correct one deliberately ambiguous worker stencil and rename it. Existing
   subject/stencil and label checks; new import-session continuity observation.
4. Inspect privacy/provenance, then complete on the practice diagram. New privacy
   observation plus confirmation of the imported public seed identity. Explain
   this is model inference, not discovery of deployed infrastructure.

**Runner dependency:** ordinary import currently leaves the lesson and opens an
owned diagram. PR 1 must define an explicit opt-in tutorial import destination
that uses the normal parser/report while retaining the sandbox and lesson.
Do not silently change normal Open/import behavior or write a second parser.
Until that is reviewed, keep this lesson unpublished rather than fake completion.

### checks-and-fixes — Turn a warning into evidence

**II.13 · 4 minutes.** Read a finding, apply an undoable fix and distinguish static
advice from a simulated outcome. Use an invented API → event topic practice seed
with an unread topic and a small saved burst.

1. Open Checks and select the unread-topic finding. New semantic finding/rule
   observation; no reliance on translated row text.
2. Read its why, apply the offered consumer fix and name the worker. Existing
   edge/node checks plus finding no longer present; Done gates the reading only.
3. Undo, then reapply; confirm the finding and its repair track the document.
   Semantic checks result revision plus topology checks.
4. Run simulations from Checks and inspect the saved burst's evidence. New checks
   job/result observation plus actual completed-run evidence. Explain this button
   adds evidence and does not apply another repair. Do not equate zero warnings
   with a production correctness proof.

### route-by-address — Send Orders to the right service

**II.2 · 4 minutes.** A gateway matches an HTTP address instead of round-robin
distributing all work. Start from public `api-route-table`, trimmed to its source,
gateway and two destinations, retaining stable route IDs.

1. Inspect two source traffic-mix rows and their address/marker. Existing `prop`
   path checks; new route-legend observation for reading.
2. Add or edit the Orders rule and its target. Existing keyed path/topology checks
   on `routeTable`, not label matching.
3. Run the seeded mix; trace an Orders request to its matched rule and destination.
   Existing run/trace plus new route-specific trace observation.
4. Send a supplied unknown-address class and inspect its rejected 404; restore a
   Default and rerun. New route-rejection counters by reason plus downstream fresh
   processed delta. Keep precedence/first-match and Default explicit; no regex.

### network-policy — Follow an allowed and a denied path

**II.12 · 4 minutes.** Distinguish a network denial from a slow service or failed
attempt. Use an invented Browser → Firewall → API practice diagram with two
declared message types and deterministic traffic at scale one.

1. Read the firewall's policy and predict which type passes. Existing property
   checks plus Done for the prediction; neither traffic class contains secrets.
2. Go Live and inspect allowed processing and the denied/blocked count. Existing
   `compare`/`metric` checks on both classes where available; add a typed readout
   observation if class-specific network evidence is not exposed to checks.
3. Change the deny rule using the real inspector and replay the same traffic.
   Existing keyed `prop` and selected-run checks; do not inject model state.
4. Compare fresh downstream processing and explain the result. Existing delta
   counters plus explicit reading acknowledgment; state this models policy and
   transit, not a packet-level appliance or complete vendor rulebase.

### author-a-simulation — Make a repeatable experiment

**III.8 · 5 minutes.** Author traffic, one paused note and an expectation, then
save and replay. Use an invented Client → Jobs queue → Worker practice seed.

1. Create a simulation with a ten-request burst at scale one. Existing
   `savedSimulation` extended with traffic-shape matching; Run draft first.
2. Add a short paused note focused on Worker. New authored-note matching check
   verifies focus/pause, not its exact prose.
3. Add “Worker completes 10” as an end expectation. Existing saved-expectation
   count plus new typed expectation-definition matcher for metric/op/value/when.
4. Save, run, Continue and inspect the decided expectation. Existing simulation,
   note and expectation checks; require the saved ID and matching definition.
5. Replay and inspect the same result. New run-generation observation plus the
   same outcome; explain seed, setup overrides, timeline and end versus always.

### sequence-evidence — Explain one request's journey

**III.6 · 4 minutes.** Move from a trace to shareable evidence of one journey.
Use public `kafka-order-pipeline` and its saved Black Friday run.

1. Trace the next message from Storefront. Existing run and `trace` checks.
2. Inspect one wait/call hop, then open Sequence diagram. New semantic sequence
   surface observation tied to that trace ID.
3. Copy as Mermaid or download Sequence SVG using keyboard-accessible controls.
   New successful export observation includes format and trace ID; never read the
   user's clipboard to verify success.
4. Return to the same trace and explain what it cannot show. Existing trace plus
   Done for the reading: one journey is not a p95 distribution or all branches
   from every request. Optional slowest/dead-letter trace can extend the practice.

### resource-headroom — Explain a capacity ceiling

**III.4 · 4 minutes.** Separate offered demand, resource assumptions and measured
simulation results. Use an invented CPU-limited image worker with a small queue,
explicit resource profile and a short saved burst.

1. Read workload/CPU/thread assumptions in Properties. Existing `prop` checks plus
   semantic details observation; supplied values are labelled assumptions.
2. Open the capacity explanation and identify the binding constraint. New typed
   planning-result observation keyed by constraint kind; Done for interpretation.
3. Increase the binding resource/replica count and replay. Existing `prop`, run and
   fresh processed/backlog comparisons; keep the same seed and offered traffic.
4. Inspect Inputs at higher demand and the revised explanation. Existing input
   multiplier checks plus planning observation. Explain static headroom versus
   startup/transient behavior and unknown managed-service budgets; do not promise
   an unshipped generic scenario-comparison dashboard or cost estimator.

### scale-on-backlog — Scale workers for waiting jobs

**IV.6 · 4 minutes.** Match KEDA's queue/lag signal to the workload and find a
partition ceiling. Use public `autoscaling-basics`, preserving its executable
policies and stories; select the broker/worker subset for practice.

1. Inspect the broker signal, target and minimum/maximum. Existing property-path
   checks through the current autoscaling model and semantic configuration view.
2. Run a short saved burst and watch Starting become Ready. Existing fleet metrics
   and simulation checks; do not use a wall-clock growth deadline.
3. Observe that replicas beyond the partition ceiling cannot all consume. Existing
   replicas/partition comparisons plus real backlog/readout evidence.
4. Raise partitions or apply the verified scenario-sizing suggestion, replay and
   inspect draining backlog. Existing properties and processed/backlog metrics;
   new sizing-finding observation if using that path. Explain why HPA CPU or cloud
   request metrics would answer a different question. Mandatory path uses one
   controller, not every vendor adapter.

### export-for-audience — Give someone the right artifact

**VII.2 · 4 minutes.** Choose static, editable or runnable output and state who
can open it. Use the public `kafka-order-pipeline` practice copy with one saved run.

1. Present and inspect the diagram's title/annotations. Existing presenting check
   and Done for readability; return with Escape.
2. Export SVG or PNG through the real dialog. New successful image-download
   observation scoped to document revision; tests inspect file contents/dimensions.
3. Export Interactive HTML with the saved run. New HTML-export completion
   observation; browser test opens the downloaded file offline and plays it.
4. Read audience/password choices and compare with editable diagram JSON. Done
   for the decision, not a fake security check. Optional password file path uses
   a public test password and a decrypt/replay test; no public upload required.
5. Optional-within-step hint: Record video or embed routes are alternatives when
   the recipient needs a recording or an app-integrated viewer. Do not require
   recording every lesson, accounts or publishing an embed to graduate.

### work-together — Know what your collaborator controls

**VII.3 · 5 minutes after setup.** Distinguish editing rights from following a
host's live run, and leave with a recoverable device copy. Use an invented public
two-service room diagram; build availability is explained before Start.

1. Open Edit together, read consent and start a practice room. New room-state/role
   observation; no real recipient or message is involved.
2. Join in a second browser session and observe one partner edit. Semantic room
   event plus model revision/label checks. UI solution uses an isolated peer fixture
   in tests; a learner needs a second tab/session or a willing partner.
3. Host a saved live run and follow it from the peer. New Watch Live role/run
   observation tied to the shared run, not the camera's similarly named Following.
4. Stop following/leave and find the device recovery state. Semantic disconnected
   state plus recovery identity. Teach who can edit and what remains after leaving.

If collaboration is disabled or a transport cannot connect, explain availability
and offer a local demonstration or “Return to syllabus”; do not record the
hands-on checks as passed. Scope alternate completion/seal behavior in the owner
decision below. A real two-person setup may exceed five minutes; that time is
excluded explicitly, not hidden in the estimate.

### review-agent-changes — Keep control of an AI edit

**VII.4 · 4 minutes.** Review a small agent change, undo it and understand data
boundaries. Use an invented Status API practice diagram and a supplied deterministic
Advanced reply that adds one worker; no live model required.

1. Open AI and read supported ways to ask an agent. New dock/surface observation
   plus Done; explain the dock normally shows turns, not a universal chat box.
2. Copy selected context and apply the supplied reply through Advanced. New
   successful AI-turn observation plus existing node/edge checks. Clipboard write
   success is sufficient; do not send anything to an external chatbot.
3. Inspect the diff/highlight, then Undo this change and Revert to here on a second
   supplied turn. Semantic turn/history observation plus expected model states;
   test both operations, not just button clicks.
4. Read Private/on-device/agent limits and finish with a deliberate next choice.
   Done for the explanation. Skill installation, actual WebMCP assistant requests,
   dictation and model downloads are optional outbound paths, never prerequisites.

## Cross-cutting experience work

### Content-only contracts

- Intro: one outcome, one “why it matters” sentence, prerequisites and a truthful
  time estimate. Keep the existing one Start action and sandbox explanation. Use
  familiar words, no paragraph of UI navigation before the outcome.
- Steps: **act → observe → explain**. One main action per step; settings needing
  several clicks get a short route and an optional checklist. Name current visible
  controls (Properties, Edit properties, More), not screen coordinates. Hints carry
  alternative keyboard/menu routes; coachmark tips stay shorter than full goals.
- Feedback: say what changed and what it means. Do not present a passed config
  check as measured behavior, a Done click as comprehension, or a green
  expectation as proof of architecture correctness. Explain saved setup replacing
  a just-edited value before selecting that comparison.
- Observation steps should require a relevant readout and a meaningful result.
  Use fresh deltas/new-run identity when the promise is “after this change.” Keep
  existing seeded outcomes and causal thresholds with margins; use operation
  counts/fake clocks for test mechanics, not stopwatch budgets.
- End with two sentences: “You changed X; Y showed the effect” and one limitation
  or transfer question. Keep the existing next-lesson handoff and Save a copy;
  public reference examples remain optional. Studies compare reasoning and
  evidence, not whether the canvas matches a reference screenshot.
- Translation: all new/revised UI prose uses `t()`/`msg()` keys in
  `src/i18n/en.ts`, including tips, near-miss and completion messages. Use translated
  search/display helpers; never translate IDs, paths or enum values. Run regen and
  i18n check. Review long pseudo-locale, RTL and real translated copy; no automatic
  translation stamping as part of content edits.

### Shared runner/UI work — PR 1, higher risk

This means the **tutorial engine**, not the simulation engine. No simulation
algorithm change is required by this plan.

1. Bring the existing `finish.text` into the finish handoff's reading order before
   next-lesson detail, removing redundant visible copy if needed. Maintain
   nonmodal interaction, current heading focus, Escape cleanup and one primary
   Start action. Do not replace #399's handoff or announce the recap twice.
2. Clamp **measured** tips within the available pane, considering strip, rail,
   dock, transport, narration and visual viewport; use logical sides for RTL.
   Prefer a useful visible field, then its disclosure, then subject fallback.
   Don't move the camera repeatedly just because a tooltip is clipped. Add a
   non-intercepting compact strip hint when no target is available.
3. Preserve the event-driven machine and subject-based checks. Add small typed
   observation ports for dock/view, checks jobs/findings, exports, imports,
   AI turns and collaboration. A successful download means the real writer
   completed; a configured diagram means document/effective props, not DOM text.
   Test fake publications and real UI paths. Do not store arbitrary test actions
   in progress or make production depend on `window.__tutorial`.
4. Implement opt-in import/save tutorial policy explicitly: keep temporary edits
   isolated; only library-reuse's explicit copy writes ownership. Existing
   no-autosave assertions stay on every other lesson. Closing, failing or cancelling
   imports/exports/joins must not advance a step. Cancel delayed work on Restart,
   Exit or a replacement document. Keep file handles/provenance on normal Open.
5. Recovery: keep Show me, editable near-miss fixes, Skip, Undo and versioned
   Continue reconstruction. Handle unavailable/failed asynchronous demo operations
   with in-place Retry/Exit; never wait forever for a check after a rejected move
   or download. Re-audit existing backlog IDs against current code before changing
   behavior: some recorded issues are already resolved. Keep learner drafts,
   unrelated settings, setup overrides and authored load intact during repair.
6. Phone: verify 390 px and a short landscape viewport with the bottom rail,
   three-height dock, keyboard and expanded Read note sheet. Instruction/Done/Exit
   must remain reachable without covering the target. A phone should not have to
   hover. Test zoomed text, expanded pseudo-locale and `prefers-reduced-motion`.
7. Keyboard/accessibility: every required action needs a keyboard route and a real
   completion check. Audit connection creation/reconnect, boundary movement and
   box selection especially; if the product lacks an equivalent action, that is
   a product accessibility dependency, not something Skip can certify. Add a
   keyboard solution variant per lesson; reserve Skip for explicit assistance.
   Preserve focus settlement, roving toolbar/tab keys, polite announcements and
   annotation Escape/Ctrl+Enter versus naming Enter. Axe complements this; it
   cannot prove keyboard completion or screen-reader comprehension.
8. Introduce the shared chapter descriptor before adding VII, keyed by track ID,
   used by syllabus, counts, order, seals and finish. Test migration/retained seal
   dates, scoped reset, cross-tab Undo protection and new catalog versions. Keep
   tutorial metadata/steps lazy; enforce existing entry/canvas chunk budgets.

If the new observation/import lifecycle work cannot fit a reviewable PR, reduce
the first release scope rather than create a generic UI automation framework.
Do not merge a multi-week runner rewrite merely to satisfy a batch count.

## Batch plan: six ready-for-review PRs

The counts below refer to **new or substantively revised lessons**. All 49 current
lessons gain the shared ending/readability improvements from PR 1. The 16 retained
exercises listed after the table need a routine content/UX review in their themed
batch, but no forced step churn or artificial new exercise. New lessons remain
unregistered until their checks and real UI solution are ready.

| PR / order                                   | Scope and lesson count                                                                                                                                                                                                                                                | Expected tests and output review                                                                                                                                                                                                                                                                                                                                                                           | Risk / estimated engineering effort                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Tutorial runtime and completion contracts | **0 new lesson registrations**. Shared work above; temporary Lab fixtures for new observation ports and import/save policies. Chapter descriptor groundwork, preserve six-chapter rendering until VII lands.                                                          | Machine event paths; false/rejected/late actions; paths/checks/repair tests; resume, Undo and interrupted async work; existing tutorial solution/Skip-all plus focused keyboard/phone/RTL/finish tests. Under-load Linux affected specs and neighbours for camera/focus/layout. Verify startup chunks and size. Intended UI/i18n output changes get reviewed parity updates; no simulation golden changes. | **High**, 4–7 engineer-days plus review. First and on its own. Acceptance is bounded capability work, not new simulation machinery.                                              |
| 2. First successful diagram and keeping work | **9**: new workbench-tour, library-reuse, import-and-review; revise mobile-api, quick-add, dots-and-sides, property-sheet, annotate, command-palette. Review retained insert-on-edge, request-vs-message, boundaries, dependencies, arrange.                          | Per-ID UI solutions, keyboard variants, Skip/Continue; real parser/report integration, explicit-copy ownership test, normal Open still exits safely, no autosave on other lessons. Unit catalog/subjects/settlement and locale search checks; update intro/finish tests.                                                                                                                                   | **Medium/high**, 4–6 days. Import continuity depends on PR 1; manual visual walkthrough is the first activity.                                                                   |
| 3. Building blocks you can verify            | **9**: new checks-and-fixes, route-by-address, network-policy; revise api-gateway, kafka-topic, queue-workers, cache-aside, partitions, outbox. Review retained load-balancer, webhooks, fanout, dependencies-2.                                                      | One real UI solution per lesson; check-fix Undo, worker evidence, route precedence/Default/refusal, policy counters, broker conservation and setup override units. Retain actual outcomes in completion sweeps; add deliberately wrong alternatives so checks reject near misses.                                                                                                                          | **Medium**, 4–6 days. Routing/network fixtures need domain review; no matching/engine algorithm changes.                                                                         |
| 4. Explain and author an experiment          | **9**: new resource-headroom, sequence-evidence, author-a-simulation; revise rates-and-inputs, read-a-node, capacity, trace-slowmo, saved-simulations, author-a-drill. Review retained faults.                                                                        | Per-ID real UI/keyboard solutions; saved/draft definitions, pause/Continue, repeatable end expectation, same-trace Sequence export bytes and download failure, Free play versus saved rate/setup. Unit semantic observations; camera/focus/Linux repetition for new view guidance.                                                                                                                         | **Medium/high**, 4–6 days. Transient run/view states and file export are the main risks. Keep assertions causal.                                                                 |
| 5. Diagnose waiting and recover deliberately | **9**: new scale-on-backlog; revise where-time-goes, threads-block, timeouts-pools, autoscaling, scale-to-zero, backoff-budget, circuit-breaker, dead-letters. Review retained backlog-lag, retry-storm, rate-limit, shared-api-quotas, load-shedding, health-checks. | Per-ID real UI/keyboard solution; setup/effective prop and fresh-run checks; frozen narration for transient readings; pool/deadline/callee-late work and controller signal units. Retain existing seed/threshold/expectation evidence. Never record DLQ replay as an available action.                                                                                                                     | **Medium**, 4–6 days. Review long comparisons with a new learner; keep content fixes out of engine behavior.                                                                     |
| 6. Apply, present and collaborate            | **10**: new export-for-audience, work-together, review-agent-changes; revise share-present and all six studies. Introduce VII and move share-present while keeping its ID/progress.                                                                                   | Per-ID real UI solutions and keyboard paths; all-channel/cell outcome checks and wrong-design negatives; offline HTML replay, SVG/PNG artifact assertions, isolated two-peer room fixtures/roles/leave, deterministic Advanced turns/Undo/Revert. Hub/numbering/seal/reset/finish regression and capability-off builds.                                                                                    | **Medium/high**, 5–8 days. Two-session setup, optional capabilities, study scope and progress migration need the most review. No external AI call or real person required in CI. |

Totals: **13 new + 33 revised = 46 lesson-level changes** across five content
PRs (9 + 9 + 9 + 9 + 10); all 49 current lessons reviewed. The 16 retained
exercise IDs are insert-on-edge, request-vs-message, boundaries, dependencies,
arrange, load-balancer, webhooks, fanout, dependencies-2, faults, backlog-lag,
retry-storm, rate-limit, shared-api-quotas, load-shedding and health-checks.

Effort is approximately **25–39 engineer-days**, plus owner decisions, a learner
usability pass and independent review/CI turnaround. This is several weeks of
work, not six small copy-only PRs. Do not promise five minutes for design studies
or include agent/collaboration setup in a misleading lesson estimate.

Each content PR ends with a dated release fragment and UX review, schema/skill/
i18n regeneration where relevant, catalog/metadata/ID consistency tests and the
generated “solution plays through the real UI” and Skip-all cases. Test the actual
export/import/repair side effects separately: a scripted solution sharing the
same assumptions as its checks can still be wrong. Every fix gets a failing
regression demonstrated with the fix removed. Add negative/distracted learner
paths, Continue and unsaved draft coverage where the lesson depends on them.

New public simulation/planning/stencil exercises should be first-class public
examples or extend the named public examples. Their feature should become visible
within about ten seconds of Live, with an executable saved story, appropriate
existing `shows` tags (or a separately reviewed vocabulary extension), example
tests and parity coverage. Do not add a tag solely from an icon. Keep small
interaction-only fixtures in the Lab and avoid multiplying thin gallery entries.
New import/AI samples are invented public data, usable offline in tests.

Output policy: **this audit changes no golden**. Future content/i18n changes will
normally change catalog fingerprints/counts; each PR must enumerate its actual
goldens. New public examples or intentionally changed stories may add/change
simulation, layout or export goldens, each explained individually. Shared runner
refactors and performance fixes must leave diagram-output goldens unchanged;
never re-record a failing golden without an intentional output change.

## Decisions and rejected directions

- Keep studies long and outcome-driven. Reject one PR per lesson and a wholesale
  rewrite of already strong resilience exercises: both dilute review and create
  needless progress resets.
- Add one seventh workflow chapter. Reject separate AI, vendor and export
  chapters: there is not enough required hands-on material for three new tracks,
  and optional capabilities should not interrupt architecture prerequisites.
- Keep optional controls in hints/Properties/context menus. Reject new global
  teaching chrome, compulsory quizzes, badge inflation, modal celebration and
  another confirmation before Start next.
- Reject external-model success, live public matchmaking or a cloud account as a
  CI/learner prerequisite. Use deterministic public replies and isolated peers;
  clearly distinguish a demonstration from hands-on completion.
- Reject teaching roadmap-only or unsupported actions: arbitrary C4 drill-down,
  production measurement, correlated cache misses, atomic outbox transactions,
  DLQ replay, packet-accurate appliances or a generic cost dashboard. Endpoint/API
  contract fields and imported data do not by themselves prove a complete endpoint
  authoring/OpenAPI workflow. Verify any expansion separately before promising it.

## Open questions for the owner

1. Approve VII and 13 new lessons, with the 16 strong exercises retained rather
   than rewritten? Moving share-present retains its ID and earned completion.
2. Should the whole-syllabus seal require capability-dependent collaboration/AI
   hands-on completion, or should those be optional extensions? Recommendation:
   keep the core seal attainable offline and explain extension completion.
3. Approve an explicit saved-copy lesson and sandbox import destination, with
   disposable public fixtures and no automatic saving elsewhere?
4. Keep the six 20–25-minute studies as capstones? Recommendation: yes; improve
   milestones/checklists and recaps rather than splitting them into short lessons.
5. Is the 25–39-day scope acceptable, or should the first release stop after PR 4
   and leave advanced scaling/team workflows for the next curriculum release?
