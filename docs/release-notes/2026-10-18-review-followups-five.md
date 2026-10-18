## Review follow-ups five

Forward seeks now discard held edge highlights and derive activity from the destination snapshot, including while paused. A controller-owned continuity token also separates rebuilt runs; it lives in a WeakMap and never changes serialized simulation output.

Inspector count formatting and bulk undo tags now live below the panels in `selectionSummary.ts` and `editTransactions.ts`. Property counts, inert-value formatting and edge choices also have dedicated modules, leaving component exports compatible with Fast Refresh. Diagram and annotation panels no longer acquire the bulk/edge implementation graph through shared functions.

The stencil drag preview has a production-browser regression for fixed, offscreen positioning and unchanged palette layout. The stylesheet order is unchanged.

Live benchmark capture now starts and seeds its timeline at the traffic mutation, samples transitions and layers through panel closure, accepts regular low-frame-rate traces, includes a frame gap crossing the steady-window boundary, and preserves `settled: false` at an unstable timeout. Workload counts determine gate eligibility; missing decoration fails explicit preconditions and cannot disable the dedicated large-diagram limits.

## Regression proof

Each deliberate regression below was rejected, then restored:

| Change removed or regressed                           | Test                       | Observed rejection                                       |
| ----------------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| Original inspector imports and mixed exports restored | `moduleBoundaries.test.ts` | Both panel graph checks and Fast Refresh check fail      |
| Forward-seek continuity check removed                 | `decorations.test.ts`      | Destination activity checks fail paused and playing      |
| Eight required gaps restricted to five seconds        | `liveMetrics.test.ts`      | Regular 1 fps and 0.2 fps traces fail settling           |
| Gap crossing the steady-window boundary discarded     | `liveMetrics.test.ts`      | Boundary-stall regression fails                          |
| Unstable-tail guard removed from slow-phase analysis  | `liveMetrics.test.ts`      | Timeout incorrectly reports settled                      |
| Stability forced while collecting a capped capture    | `liveCapture.test.ts`      | Completed unstable recording incorrectly reports settled |
| Transition eligibility tied to decorator output       | `liveMetrics.test.ts`      | Missing-decoration gate regression fails                 |
| Dedicated churn limit tied to decorator output        | `liveMetrics.test.ts`      | Missing-decoration gate regression fails                 |
| Decorated-element equality precondition removed       | `liveMetrics.test.ts`      | Incomplete-decoration regression fails                   |
| Initial timestamp removed                             | `liveCapture.test.ts`      | Both traffic paths miss the initial stall                |
| Hook capture started after mutation                   | `liveCapture.test.ts`      | Hook-path stall regression fails                         |
| Capture stopped before panel closure                  | `liveCapture.test.ts`      | Panel-path transition peak regression fails              |
| `nodes.css` and `quick-add.css` imports swapped       | `flow-building.spec.ts`    | Preview position is `relative`, expected `fixed`         |

## Output and scope

No parity golden changes are intended or recorded. No new simulation, planning or stencil feature is added, so this fix needs no new showcase. The engine-cost-estimate follow-up in LiveSession remains reserved for its owning branch. Camera, slow-motion, menu, selection and focus call sites are untouched. Local benchmark runs are deliberately excluded; browser benchmark confirmation uses the comparison Actions workflow.
