## Runtime review

The finish handoff reads its heading, the existing lesson recap, then the next lesson.
The strip retains Finished and Save a copy. The recap is neither repeated in the strip
nor added to the polite completion announcement. Heading focus, Escape cleanup and the
single primary Start remain. No modal celebration or extra global control was added.

Coachmarks measure wrapped text and use clear panes within the visual viewport, below
the instruction strip. The rail, dock, transport, canvas controls and narration are
obstacles unless they contain the target. Visible fields precede disclosures and
subjects; clipped fields fall back. Logical inline-end is preferred in RTL. A compact,
non-intercepting strip hint replaces a tip when there is no clear place for it. Geometry
measurement never requests camera movement.

Failed demonstrations retain the sandbox and show Retry with Exit still available in
the bar. Retry receives keyboard focus. Restart, Exit and document replacement cancel
pending work; a boundary move checks cancellation after its lazy download. Existing
repair code continues to own drafts, authored load, setup overrides and unrelated props.
Phone instructions scroll within a bounded strip, leaving its actions reachable. The expanded Read note sheet is capped to the measured space between that strip and its caption mount, so it cannot cover Done in short landscape. Its body scrolls, including when the visual viewport shrinks.

## Backlog audit

Rechecked the IDs in `2026-10-24-tutorials-quarantine.md` against current code:

- R-4292fd18ff remains reproducible: asynchronous membership results were discarded.
  This change awaits false/rejected moves and offers recovery before waiting for a check.
- R-352145058d remains reproducible: annotation completion used the naming Enter hint.
  The tutorial now names Escape or Ctrl/Cmd+Enter.
- R-cf6cdf20ea remains reproducible: boundary selections use flow IDs while subjects use saved IDs. A shared adapter now normalizes selection checks and naming; unit regressions also cover a boundary selection settlement through Skip.
- R-26013c9d03 still lacked a typed note assertion. The existing browser regression now types a distinctive note before Skip and verifies it survives, alongside the corrected completion hint.
- R-7afb59dfff already has an explicit compensation acknowledgment step.
- R-bf8c4f3d0d already restores authored reference multipliers in repair.
- R-8f80384677, R-a6bca6f442 and R-f8727feff3 concern delayed naming or repair
  integration coverage; existing cases are retained. This PR does not replace the
  session command layer or change the simulation engine.

## Keyboard audit: product dependencies

Audited the 49 lessons' required actions against the current action registry and
keyboard navigation. Skip is assistance and does not certify keyboard completion.
The older curriculum audit's connection/reconnect concerns are already addressed in
product code: they must not be reported as missing commands.

| Lesson     | Required action without an equivalent product keyboard route                                                                                                                                                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| boundaries | `select`: choose only Services 1 and 2 while leaving Service 3 out. Keyboard navigation replaces selection rather than extending a subset. `drag-in`: adopt Service 3 into an existing boundary. Arrow nudges change positions through `moveSelection` without settling membership, so nudging inside does not satisfy the member check. Ctrl+G itself is available. |
| arrange    | `box`: choose a spatial subset. Ctrl+A satisfies this fixture's count check, but does not provide general box selection or arbitrary subset selection. Alignment and Tidy are available through menus/palette once selected.                                                                                                                                         |

The remaining 47 lessons use existing commands, fields and reading surfaces; their
mouse solutions still need keyboard variants. In particular, these routes already exist:

| Lesson             | Current keyboard route to preserve and exercise in the content batch                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mobile-api         | `connect`: select the source, Shift+F10 → Connect to → target, or the corresponding Ctrl+K action.                                                                                                                                                      |
| dots-and-sides     | `connect`: Connect to. `side`: select the edge and choose its To side → Top. `reconnect`: select the edge, Reconnect → To → target, or the corresponding Ctrl+K action. These use `updateEdge`/`reconnectEdge`, retaining the original edge's settings. |
| request-vs-message | `connect`: Connect to from the existing API to the topic.                                                                                                                                                                                               |
| dependencies       | `draw`: Connect to from the service to the vault; the normal inference chooses the dependency.                                                                                                                                                          |
| where-time-goes    | `read-breakdown`: keyboard readout traversal and the selected-node dock already provide reading surfaces; a lesson variant must verify the same latency evidence.                                                                                       |
| read-a-node        | Use keyboard readout traversal or the selected-node dock and Events controls; the lesson's hover-based solution is not keyboard-completion evidence.                                                                                                    |

Sources: `node.connect`, `sideMenu` and `edge.reconnect` in
`src/editor/builtinActions.ts`; the document-scoped palette regression in
`src/palette/sources.test.ts`; single-selection navigation in
`src/canvas/selection/useCanvasNavigation.ts`; `moveSelection`/`nudge` in
`src/editor/useEditor.ts`. No product command is added here.

Node/edge hover observations in api-gateway, kafka-topic, queue-workers, load-balancer,
cache-aside, webhooks, partitions, capacity, rates-and-inputs, trace-slowmo, retry-storm,
threads-block, timeouts-pools, autoscaling, scale-to-zero, backoff-budget, circuit-breaker,
load-shedding, dead-letters and health-checks need dock/readout keyboard solution
variants in the content batches. Existing keyboard readout traversal complements the
dock; the audit does not certify comprehension or replace semantic checks.

Tutorial-side changes preserve handoff heading focus, focus Retry after failure, remove
duplicate recap announcements and correct annotation completion keys. Observation ports,
import/save policy and per-lesson keyboard variants remain PR 1b work.
