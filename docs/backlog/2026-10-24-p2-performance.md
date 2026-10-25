## P2 triage: Performance (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 13 / STALE 0 / OPEN 4 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. DONE means code and/or the specifically requested regression exists with merged-PR evidence; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Pointer and placement work (3 DONE)

1. **P-01 — DONE: Skip hover bridge geometry without an unpinned readable target.** `src/live/NodeBadges.tsx:227`. Queue: #250/#248/#252.
   Every pointer move can search the document and measure pinned cards. Return before queries when no unpinned readable card is open; count selector/rectangle calls for absent, pinned and unpinned states.

2. **P-02 — DONE: Exclude timeline progress churn from placement invalidation.** `src/live/HoverCard.tsx:42`. Queue: #248/#252.
   A subtree observer sees frequent style changes around controls. Observe only protected-control visibility/size changes and assert no placement calls for timeline-only progress while still responding to actual resize.

3. **P-14 — DONE: Compare displayed breaker countdown buckets.** `src/live/BreakerReadout.tsx:42`. Queue: #251 r3.
   Raw millisecond updates cause avoidable rerenders despite unchanged displayed text. Derive the display bucket in the selector and count renders across ticks and bucket boundaries.

Implemented on `fix/p2-performance-pointer-1`. `hoverBridge.test.ts` counts zero
selectors/rectangles for absent, pinned and unreadable cards, and two of each per unpinned
pointer event. `protectedControls.test.ts` excludes timeline style/text churn while covering
root visibility, resize, membership and cleanup. `BreakerReadout.test.tsx` counts display
renders across unchanged ticks, second boundaries, settled totals and state transitions.
Each regression was checked with deliberate mutations; output goldens are unchanged.

## Batch 2: Bundle and distribution build cost (2 DONE, 1 OPEN)

1. **P-03 — DONE: Build the merge-base with its own lockfile dependencies.** `scripts/bench/bundle-base.mjs`. Queue: #271.
   Changed-lock baselines use a frozen install cached by the base lockfile's SHA-256, Node version, platform and architecture. Complete installs are published atomically without moving pnpm's Windows junction targets. Identical lockfiles retain the zero-install path. `src/lib/bundleBase.test.ts` resolves two real local package versions, proves the base uses its own version, and counts one install across repeated measurements. Restoring HEAD's dependency link fails that regression.

2. **P-04 — DONE: Keep expensive ZIP compression off dev request/startup paths.** `scripts/skill-assets.ts`. Queue: #243/#260.
   Dev viewer files and explicit ZIP downloads now have independent caches. Viewer/file requests never start compression and complete while a ZIP is held; ZIP failures can retry. `src/lib/skillAssets.test.ts` covers serving, invalidation and retry, and fails with the old coupling restored. The isolated `scripts/bench/skill-dev.mjs` measured cold viewer requests at 6,677–7,659 ms before and 24–44 ms after; listen startup was 10.12/9.30 ms. Production compression and the 835,000 B cap are unchanged; the 831,669 B ZIP remains byte-identical. See the [release fragment](../release-notes/2026-10-24-performance-tooling.md) for method and hash.

3. **P-05 — OPEN: Restore startup/canvas/Live headroom with dedicated trims.** `docs/QUALITY.md:36`. Queue: #260/#271.
   The optional-surface trim left budgets below the warning floor. Schedule one owner per surface, prefer a smaller viewer payload over more Zopfli iterations, keep limits fixed and verify held-chunk behavior.

## Batch 3: Collaboration work-count assertions (1 DONE)

1. **P-15 — DONE: Assert linear work in room lifecycle/performance coverage.** `src/collab/session.test.ts`. Queue: #182.
   Independent `opGrowth()` assertions measure document projection at 64/512 nodes (with edges) and presence reads at 8/64 peers. Work grows 836 → 5,764 (6.90×) and 25 → 247 (9.88×), within the existing 24× bound. Fixtures and invalidation are outside measurement; a real edit must reread exactly one record. Separate nested document and presence scan mutations both exceed the operation budget. No runtime change or clock budget is needed.

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
