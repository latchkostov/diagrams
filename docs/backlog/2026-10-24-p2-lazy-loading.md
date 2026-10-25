## P2 triage: Lazy loading (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 18 / STALE 0 / OPEN 1 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. DONE means code and/or the specifically requested regression exists with merged-PR evidence; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Loader ownership and HMR (1 OPEN, 1 DONE)

1. **LL-01 — OPEN: Give cold node details a keyboard focus handoff.** `src/live/NodeBadges.tsx:33`. Queue: #189.
   The shared loader provides recovery but does not itself prove the original cold keyboard-entry contract. Hold node details, enter by keyboard and transfer logical focus only while the request still owns it.

2. **LL-02 — OPEN: Make surface registrations survive HMR.** `src/lib/lazySurfaces.ts:77`. Queue: #271.
   Module-owned registrations replace their previous hot evaluation, preserve mounted consumers in output readiness, and dispose inactive registrations. Genuine duplicates still throw. Registry and dev-transform regressions cover replacement before/during an export; the generated hold-the-chunk browser contracts remain unchanged. Implemented on `fix/p2-tooling-followups` (merge pending).

## Batch 2: Output, retry and late-load regressions (5 DONE)

Batch 2 test work is complete on `fix/p2-lazy-loading-tests` (merge pending). LL-04's newly
exposed product gap remains tracked separately; DONE here refers to the requested test contract.

1. **LL-03 — DONE: Cover recording while an output chunk is held.** `tests/e2e/lazy-recording.spec.ts`. Queue: #271.
   Real tab capture waits before countdown while narration is held, then verifies the released
   surface in captured pixels and the encoded recording. Readiness-bypass and wrong-stream mutations fail.

2. **LL-04 — DONE: Assert awaited surface content in exported SVG.** `tests/e2e/lazy-surfaces.spec.ts`. Queue: #271.
   Generated output contracts check call pills, thread meters and nested session content in the
   SVG, retaining the existing capacity checks. Readiness/content mutations fail. Narration is
   missing from the product's SVG: its failing content assertion is retained as `test.fixme`,
   with the enabled readiness case preserved. See [the product follow-up](2026-10-24-awaited-narration-svg.md).

3. **LL-05 — DONE: Establish focus before the held download fails.** `tests/e2e/lazy-live-fixes.spec.ts`. Queue: #264.
   The scrubber request stays held until Play is explicitly focused, then fails; Retry restores
   the scrubber, expectations and Play focus. Failure-focus and Retry-handoff mutations fail.

4. **LL-06 — DONE: Await module evaluation before late-load cancellation assertions.** `tests/e2e/chunk.ts`, `tests/e2e/fault-drills.spec.ts`, `tests/e2e/lazy-live-fixes.spec.ts`. Queue: #173 bundle-fix / #264.
   SimPanel, slow-motion readout and simulation timeline await import evaluation and render
   frames, assert loaded/inactive registration, then assert cancelled UI stays closed. Removing
   cancellation ownership cleanup fails all four cases, including both SimPanel close paths.

5. **LL-19 — DONE: Retry must restore Advanced controls, not just the always-visible fields.** `tests/e2e/inspector-live.spec.ts`. Queue: #260 r2.
   Retry must render Appearance & routing, expose From side and persist an edit to the saved
   edge. Dismissing the error without retrying and dropping the edit handler both fail.

## Closed or superseded findings

| ID    | Status | Finding and current evidence                                                                                                                                                                                                                   | Fixing PR / reason                                       |
| ----- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| LL-07 | DONE   | **Lazy simulation-editor handoff and Retry** — `tests/e2e/fault-drills.spec.ts:79`. The shell keeps its opener through loading; the registered simulation-panel surface now shares failure recovery through #271.                              | [#271](https://github.com/latchkostov/diagrams/pull/271) |
| LL-08 | DONE   | **Delayed narration respects an open menu** — `tests/e2e/lazy-loading.spec.ts:61`. Narration uses the lazy surface shell and guarded focus rather than an unconditional completion focus.                                                      | [#215](https://github.com/latchkostov/diagrams/pull/215) |
| LL-09 | DONE   | **Playback remains usable while capacity loads** — `tests/e2e/lazy-loading.spec.ts:40`. The held-capacity browser regression continues playback without waiting for the panel chunk.                                                           | [#215](https://github.com/latchkostov/diagrams/pull/215) |
| LL-10 | DONE   | **Failed narration recovers from shell-owned Retry** — `tests/e2e/lazy-loading.spec.ts:84`. The lazy narration test exercises failure, Retry and preserved playback.                                                                           | [#215](https://github.com/latchkostov/diagrams/pull/215) |
| LL-11 | DONE   | **Retry restarts a failed request background check** — `tests/e2e/request-checks-chunk.spec.ts:80`. Retry reconnects the background request-check path, not just the visible card; #234 retains passive real-worker coverage.                  | [#230](https://github.com/latchkostov/diagrams/pull/230) |
| LL-12 | DONE   | **Editor focus survives held request-cache completion** — `tests/e2e/request-checks-chunk.spec.ts:30`. The browser coverage preserves editor focus and selection when findings arrive.                                                         | [#234](https://github.com/latchkostov/diagrams/pull/234) |
| LL-13 | DONE   | **Cancelled slow-motion download settles without replay** — `tests/e2e/lazy-live-fixes.spec.ts:30`. Follow-ups 16 added module-evaluation cancellation coverage; newer generic surface coverage remains independently tracked.                 | [#234](https://github.com/latchkostov/diagrams/pull/234) |
| LL-14 | DONE   | **Saved simulation timeline has shared failure recovery** — `src/live/lazyTimeline.tsx:1`. Scrubber and expectation indicators share a recoverable lazy boundary, including Escape while held.                                                 | [#264](https://github.com/latchkostov/diagrams/pull/264) |
| LL-15 | DONE   | **Slow-motion replay status stays outside the readout download** — `src/live/slowmo/SlowBar.tsx:11`. Status is shell-owned while the slow readout is held, preserving Escape and keyboard focus.                                               | [#264](https://github.com/latchkostov/diagrams/pull/264) |
| LL-16 | DONE   | **Cancel obsolete Retry focus recovery** — `src/canvas/inspector/lazyEdgePanel.tsx:15`. The old local completion callback was replaced by the surface focus contract and controller-owned naming capture; use the held-focus browser contract. | [#271](https://github.com/latchkostov/diagrams/pull/271) |
| LL-17 | DONE   | **Retry placement and persistent recovery during downloads** — `src/lib/lazySurfaces.ts:91`. Recovery is shell-owned outside optional placement code; active failed surfaces share a persistent retry path.                                    | [#271](https://github.com/latchkostov/diagrams/pull/271) |
| LL-18 | DONE   | **TraceCard downloads only when tracing starts** — `tests/e2e/trace.spec.ts:125`. Production request observation checks entry and idle work before triggering the trace, independently of static bundle membership.                            | [#205](https://github.com/latchkostov/diagrams/pull/205) |

## Scope and verification

The original entry was a documentation triage. Batch 2 now adds the requested browser contracts,
with the newly reproduced narration SVG gap retained separately. Before taking remaining OPEN
entries, recheck them against current master and run the named regression family. Tests/CI batches
stop at bounded evidence rather than weakening assertions. No application code or output golden
changes belong to this tests-only batch.
