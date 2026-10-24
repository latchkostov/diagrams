## P2 triage: Line editing and routes (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 11 / STALE 0 / OPEN 7 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. DONE means code and/or the specifically requested regression exists with merged-PR evidence; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Export readiness cancellation (1 OPEN)

1. **LER-01 — OPEN: Cancel image-export readiness polling.** `src/canvas/edges/imageReadiness.ts:11`. Queue: #260 final.
   The loop has no abort signal and can keep scheduling frames after export cancellation. Thread cancellation through all readiness waits and assert no further frame/loader work after cancel.

## Batch 2: Saved route geometry (3 OPEN)

1. **LER-02 — OPEN: Retain spatial pruning for long route segments.** `src/canvas/geometry/nudge.ts:24`. Queue: #260 r2.
   Saved multi-segment routes can enlarge scan work during nudge-slot search. Index/query segment bounds and add operation-count coverage with a fixed set of nearby obstacles.

2. **LER-03 — OPEN: Nudge slots respect every fixed route segment.** `src/canvas/geometry/nudge.ts:24`. Queue: #260 deferred.
   A slot clear of the old endpoint geometry may intersect an interior saved segment. Check every fixed segment against candidate boxes and add a minimal interior-segment regression.

3. **LER-04 — OPEN: Waypoint interpretation is invariant under reversal.** `src/canvas/geometry/router.ts:233`. Queue: #260 deferred.
   Reversing endpoints must preserve the same saved geometric path in reverse order. Define endpoint-relative versus absolute waypoint semantics and test both orientations without changing unrelated route goldens.

## Batch 3: Gesture and editor integration coverage (3 OPEN)

1. **LER-07 — OPEN: Late resolver arrival after cancelled gesture.** `tests/e2e/flow-building.spec.ts:1699`. Queue: #248/#252 r5.
   Hold dot resolution, cancel with Escape/pointer cancellation, release and prove no highlight, connection or new undo step appears.

2. **LER-08 — OPEN: Exercise actual touch connection cancellation.** `src/canvas/placement/useConnectionPlacement.test.tsx:27`. Queue: #259.
   Synthetic unrelated touches can pass without a live touch gesture. Begin a touch-owned connection then cancel its matching touch and verify release and a fresh gesture.

3. **LER-09 — OPEN: Vendor route tables survive the real change-stencil path.** `tests/e2e/relationships.spec.ts:414`. Queue: #251.
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

This is a documentation triage, not an implementation or a new reproduction run. Before taking a batch, recheck its OPEN entries against the then-current master, run the named regression family, and retain any reduced fixture or trace. Tests/CI batches may take separate runner investigations; stop at the bounded evidence step rather than weakening assertions. No application code or output golden changes belong to this triage.
