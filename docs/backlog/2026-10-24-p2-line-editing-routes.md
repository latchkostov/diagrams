## P2 triage: Line editing and routes (2026-10-24)

Original triage checked `origin/master` at `7b6e905130a9`. After the Lane A implementation below: DONE 18 / STALE 0 / OPEN 0 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. Entries retain queue review labels. Locations are triage-baseline entry points, not the old review line numbers. Historical DONE entries have merged-PR evidence; the seven Lane A entries have implementation and regression evidence below, pending merge. A later green run alone does not close a historical failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Export readiness cancellation (0 OPEN)

1. **LER-01 — DONE: Cancel image-export readiness polling.** `src/canvas/edges/imageReadiness.ts:11`. Queue: #260 final.
   The loop has no abort signal and can keep scheduling frames after export cancellation. Thread cancellation through all readiness waits and assert no further frame/loader work after cancel.

## Batch 2: Saved route geometry (0 OPEN)

1. **LER-02 — DONE: Retain spatial pruning for long route segments.** `src/canvas/geometry/nudge.ts:24`. Queue: #260 r2.
   Saved multi-segment routes can enlarge scan work during nudge-slot search. Index/query segment bounds and add operation-count coverage with a fixed set of nearby obstacles.

2. **LER-03 — DONE: Nudge slots respect every fixed route segment.** `src/canvas/geometry/nudge.ts:24`. Queue: #260 deferred.
   A slot clear of the old endpoint geometry may intersect an interior saved segment. Check every fixed segment against candidate boxes and add a minimal interior-segment regression.

3. **LER-04 — DONE: Waypoint interpretation is invariant under reversal.** `src/canvas/geometry/router.ts:233`. Queue: #260 deferred.
   Reversing endpoints must preserve the same saved geometric path in reverse order. Define endpoint-relative versus absolute waypoint semantics and test both orientations without changing unrelated route goldens.

## Batch 3: Gesture and editor integration coverage (0 OPEN)

1. **LER-07 — DONE: Late resolver arrival after cancelled gesture.** `tests/e2e/flow-building.spec.ts:1699`. Queue: #248/#252 r5.
   Hold dot resolution, cancel with Escape/pointer cancellation, release and prove no highlight, connection or new undo step appears.

2. **LER-08 — DONE: Exercise actual touch connection cancellation.** `src/canvas/placement/useConnectionPlacement.test.tsx:27`. Queue: #259.
   Synthetic unrelated touches can pass without a live touch gesture. Begin a touch-owned connection then cancel its matching touch and verify release and a fresh gesture.

3. **LER-09 — DONE: Vendor route tables survive the real change-stencil path.** `tests/e2e/relationships.spec.ts:414`. Queue: #251.
   Model-helper coverage misses editor inference/undo. Change a configured vendor stencil through the inspector and assert routes, props and Undo in the browser.

## Closed or superseded findings

| ID     | Status | Finding and current evidence                                                                                                                                                                                                                                           | Fixing PR / reason                                       |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| LER-05 | DONE   | **Cold-rename Escape saves before the inspector arrives** — `tests/e2e/inspector-live.spec.ts:16`. The held EdgePanel/lazyEdgePanel/NodeIdentity matrix types before release, finishes with Escape and checks the resulting saved field without stolen focus.          | [#257](https://github.com/latchkostov/diagrams/pull/257) |
| LER-06 | DONE   | **Deliver the panel-arrival commit before late-focus assertions** — `tests/e2e/flow-building.spec.ts:1177`. The browser test awaits the actual inspector label and its expected value after releasing the held panel before asserting the other field still has focus. | [#248](https://github.com/latchkostov/diagrams/pull/248) |
| LER-10 | DONE   | **Superseding click-connect keeps the replacement drag alive** — `tests/e2e/flow-building.spec.ts:1283`. The controller cancels the old gesture before starting the new one; same-dot and other-dot browser regressions cover the race.                                | [#259](https://github.com/latchkostov/diagrams/pull/259) |
| LER-11 | DONE   | **Export awaits dependencies exposed by shaped or saved-route geometry** — `src/canvas/edges/imageReadiness.ts:12`. The readiness loop rechecks after geometry changes its marker, and shared output surfaces participate in export readiness.                         | [#271](https://github.com/latchkostov/diagrams/pull/271) |
| LER-12 | DONE   | **Shape rendering, ports and routing share attachment geometry** — `src/canvas/shapes/attachmentGeometry.ts:127`. Outline attachment and route escape points agree, including triangle and open-brace obstacles.                                                       | [#213](https://github.com/latchkostov/diagrams/pull/213) |
| LER-13 | DONE   | **Quick-add preview and creation share destination-aware planning** — `src/canvas/geometry/connectedMenuPlacement.ts:4`. Shape/stencil sizes use the same placement contract for preview and commit.                                                                   | [#213](https://github.com/latchkostov/diagrams/pull/213) |
| LER-14 | DONE   | **Shift resize from a nonsquare shape** — `src/canvas/shapes/resize.test.ts:4`. The shared resize adapter makes square/circle output with the opposite corner fixed and releases Shift consistently.                                                                   | [#213](https://github.com/latchkostov/diagrams/pull/213) |
| LER-15 | DONE   | **Exported image endpoints meet captured outlines** — `tests/e2e/deferred-canvas.spec.ts:63`. SVG/PNG coverage checks both endpoints with geometry and forced handle measurement deferred.                                                                             | [#224](https://github.com/latchkostov/diagrams/pull/224) |
| LER-16 | DONE   | **Cancellation during deferred shape geometry** — `tests/e2e/deferred-canvas.spec.ts:126`. The browser test cancels, resumes editing and retries after geometry arrives; stronger saved-text capture landed in #234.                                                   | [#224](https://github.com/latchkostov/diagrams/pull/224) |
| LER-17 | DONE   | **Classic Mermaid apostrophes remain literal** — `src/interop/mermaid/mermaid.test.ts:18`. YAML quote/backslash handling is restricted to extended shape attributes with classic and extended round trips.                                                             | [#224](https://github.com/latchkostov/diagrams/pull/224) |
| LER-18 | DONE   | **Extended Mermaid labels escape literal backslashes** — `src/interop/mermaid/mermaid.test.ts:54`. Extended YAML scalar round trips preserve backslashes, tabs and quotes; the separate classic-label compatibility fix remains attributed to #224.                    | [#213](https://github.com/latchkostov/diagrams/pull/213) |

## Scope and verification

The original triage was documentation only. The implementation below closes its seven open entries against the current branch baseline, `f88b544314bb`.

## Lane A implementation (2026-10-24)

| ID     | Result                                                                                                                                                                                                                                     | Regression evidence                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LER-01 | DONE: pass the export's abort signal through readiness downloads and frame waits; remove the listener and cancel the pending frame on exit.                                                                                                | `imageReadiness.test.ts` holds a loader and a frame separately, cancels, and checks that no subsequent loader/frame work starts.                                                                                                                                                       |
| LER-02 | DONE: index fixed segments and clustering candidates by orientation, track and span in the lazy saved-route geometry module. Long spans do not force a spatial-grid overflow scan.                                                         | `perf.test.ts` counts work for long saved routes with nearby obstacles and repeated slot queries past disjoint segments on the same track. An end-to-end nudge regression also covers long automatic segments beside saved routes; restoring either scan exceeds its operation budget. |
| LER-03 | DONE: every proposed segment and changed neighbour checks all relevant fixed segments. Existing shared port stubs can shorten; a move cannot create or lengthen an overlap.                                                                | `geometry.test.ts` places fixed interior tracks on both potential slots, outside the original cluster, and checks that the automatic segment stays clear.                                                                                                                              |
| LER-04 | DONE: diagonal input uses a canonical traversal, including symmetric out-and-back input. Interior bends are absolute; the first/last join bends retain their existing port-relative sliding.                                               | `shaped.test.ts` reverses endpoints and waypoint order across all 16 side pairs, with orthogonal, diagonal and symmetric routes.                                                                                                                                                       |
| LER-07 | DONE: late-resolver browser coverage cancels with Escape and primary pointer cancellation, releases the held resolver, then proves a fresh gesture works without old highlights, edges or history.                                         | `flow-building.spec.ts`, `late dot resolver stays inert` cases. Resolver subscription cleanup already handled Escape; pointer cancellation now ends the controller gesture too.                                                                                                        |
| LER-08 | DONE: matching-touch cancellation ends the controller gesture and retires XYHandle state/listeners; unrelated touch identities remain inert.                                                                                               | `useConnectionPlacement.test.tsx` begins a touch-owned connection through the real hook/watcher, cancels its owner and starts another gesture.                                                                                                                                         |
| LER-09 | DONE: the real inspector path preserves configured vendor route tables, other props and connections, and Undo restores the stencil in one step. The existing model helper already preserves these fields; no product change was necessary. | `relationships.spec.ts`, `configured vendor route tables survive inspector stencil changes and Undo`.                                                                                                                                                                                  |

No assertions or bundle limits were relaxed. Output parity: 3,151 goldens, zero changed/added/missing/stale. No golden was recorded. The separate live-bend-preview and stable-segment-identity quarantines remain OPEN in their own fragments.

Additional findings attributed to #278, #280, #281 and #283 remain unverified: the supplied queue is now an index, its archived review text has no entries for those PRs, and GitHub has no review bodies for them. This batch closes the seven concrete entries above; it does not infer or close absent findings.

Verification: 110 targeted unit/build-split tests passed (one opt-in benchmark skipped); the three new browser cases passed after their deliberately broken variants failed. The earlier three-spec production quick run passed 112 tests, zero failed/flaky. The required five-repeat Linux neighbour run exited 75 at admission because the shared worker budget was occupied; no load tests ran, and CI remains responsible for that coverage. No full gate or broad unit suite was started.

Final integration base: `dd315166d9573b1911ea8415d7d55e4f6d590d5c`. The sync was conflict-free. Post-sync targeted Node parity passed 708 cases across exports, imports, layout, annotation shapes, skill and i18n: 1,465 goldens unchanged. The three cancellation/stencil browser cases also passed after sync. The final indexed-clustering regression was separately confirmed failing with its spatial index disabled.
