## P2 triage: Performance (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 10 / STALE 0 / OPEN 7 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. DONE means code and/or the specifically requested regression exists with merged-PR evidence; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Pointer and placement work (3 OPEN)

1. **P-01 — OPEN: Skip hover bridge geometry without an unpinned readable target.** `src/live/NodeBadges.tsx:227`. Queue: #250/#248/#252.
   Every pointer move can search the document and measure pinned cards. Return before queries when no unpinned readable card is open; count selector/rectangle calls for absent, pinned and unpinned states.

2. **P-02 — OPEN: Exclude timeline progress churn from placement invalidation.** `src/live/HoverCard.tsx:42`. Queue: #248/#252.
   A subtree observer sees frequent style changes around controls. Observe only protected-control visibility/size changes and assert no placement calls for timeline-only progress while still responding to actual resize.

3. **P-14 — OPEN: Compare displayed breaker countdown buckets.** `src/live/BreakerReadout.tsx:42`. Queue: #251 r3.
   Raw millisecond updates cause avoidable rerenders despite unchanged displayed text. Derive the display bucket in the selector and count renders across ticks and bucket boundaries.

## Batch 2: Bundle and distribution build cost (3 OPEN)

1. **P-03 — OPEN: Build the merge-base with its own lockfile dependencies.** `scripts/bench/bundle-base.mjs:23`. Queue: #271.
   The baseline currently links HEAD's node_modules, so dependency changes contaminate base measurements. Cache an immutable install keyed by the base lockfile and test differing dependency resolutions.

2. **P-04 — OPEN: Keep expensive ZIP compression off dev request/startup paths.** `scripts/skill-assets.ts:154`. Queue: #243/#260.
   Dev viewer requests still wait for ZIP creation and multiple synchronous DEFLATE passes. Decouple ordinary viewer/file serving from ZIP compression, measure responsiveness, and preserve deterministic production ZIP bytes and the fixed cap. The earlier 30–100 Zopfli iterations are already gone (#272).

3. **P-05 — OPEN: Restore startup/canvas/Live headroom with dedicated trims.** `docs/QUALITY.md:36`. Queue: #260/#271.
   The optional-surface trim left budgets below the warning floor. Schedule one owner per surface, prefer a smaller viewer payload over more Zopfli iterations, keep limits fixed and verify held-chunk behavior.

## Batch 3: Collaboration work-count assertions (1 OPEN)

1. **P-15 — OPEN: Assert linear work in room lifecycle/performance coverage.** `src/collab/session.test.ts:145`. Queue: #182.
   A functional convergence assertion does not bind indexing cost. Count document/presence reads at two sizes and reject a nested scan without clock budgets.

## Closed or superseded findings

| ID   | Status | Finding and current evidence                                                                                                                                                                                                                                                  | Fixing PR / reason                                       |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| P-06 | DONE   | **Reduce label typing renders and commits** — `tests/e2e/typing-renders.spec.ts:44`. The merged typing PR narrows subscriptions and independently counts actual render work; unrelated node/inspector components no longer rerender per keystroke.                            | [#276](https://github.com/latchkostov/diagrams/pull/276) |
| P-07 | DONE   | **Index document IDs once for remote menu-target reconciliation** — `src/canvas/menus/menuTargets.ts:26`. The menu target check uses sets and includes boundaries instead of nested scans.                                                                                    | [#183](https://github.com/latchkostov/diagrams/pull/183) |
| P-08 | DONE   | **Index peer selections before rendering outlines** — `src/canvas/PresenceLayer.tsx:56`. Presence rendering builds ownership maps once, avoiding per-node scans of every peer selection.                                                                                      | [#185](https://github.com/latchkostov/diagrams/pull/185) |
| P-09 | DONE   | **Incremental retained-excess accounting** — `src/sim/admission.ts:318`. Admission ownership updates retained excess at the affected keys rather than rescanning the whole diagram.                                                                                           | [#211](https://github.com/latchkostov/diagrams/pull/211) |
| P-10 | DONE   | **Bound untrusted label wrapping work** — `src/canvas/geometry/labels.bounds.test.ts:5`. Label bounds are checked before wrapping; explicit hostile-input and counted-work regressions accompany the fix.                                                                     | [#274](https://github.com/latchkostov/diagrams/pull/274) |
| P-11 | DONE   | **Bound accumulated document state from room editors** — `src/collab/doc.bounds.test.ts:61`. Receive/update budgets quarantine the sender before accumulated state becomes unbounded.                                                                                         | [#274](https://github.com/latchkostov/diagrams/pull/274) |
| P-12 | DONE   | **Linear imported HTML stripping** — `src/interop/drawio/read.bounds.test.ts:10`. A bounded linear scan replaces the risky imported-label stripping path.                                                                                                                     | [#274](https://github.com/latchkostov/diagrams/pull/274) |
| P-13 | DONE   | **Enforce draw.io node budget before pairwise scaling** — `src/interop/drawio/read.ts:363`. Import rejects over-budget node counts before scaling/geometry allocation.                                                                                                        | [#274](https://github.com/latchkostov/diagrams/pull/274) |
| P-16 | DONE   | **Drop the expensive 30–100-iteration skill ZIP fallback** — `scripts/skill-assets.ts:78`. The production compressor is back at five iterations with unrestricted block splitting. The dev serving/compression coupling and smaller viewer payload remain separate OPEN work. | [#272](https://github.com/latchkostov/diagrams/pull/272) |
| P-17 | DONE   | **Bound thumbnail SVG allocation** — `integrations/confluence-forge/src/preview.ts:9`. The still preview caps nodes, connections and boundaries before allocating SVG and skips unreadable labels; independent browser assertions pin each limit in #224.                     | [#223](https://github.com/latchkostov/diagrams/pull/223) |

## Scope and verification

This is a documentation triage, not an implementation or a new reproduction run. Before taking a batch, recheck its OPEN entries against the then-current master, run the named regression family, and retain any reduced fixture or trace. Tests/CI batches may take separate runner investigations; stop at the bounded evidence step rather than weakening assertions. No application code or output golden changes belong to this triage.
