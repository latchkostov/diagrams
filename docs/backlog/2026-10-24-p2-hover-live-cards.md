## P2 triage: Hover and Live cards (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 13 / STALE 1 / OPEN 16 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. DONE means code and/or the specifically requested regression exists with merged-PR evidence; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Readout ownership and keyboard traversal (6 OPEN)

1. **HLC-01 — OPEN: Require an actually visible card before intercepting Enter.** `src/live/session/useLiveKeyboard.ts:85`. Queue: #247 final.
   The keyboard path checks a logical readout even when placement hides its card. Ask the shared readout visibility policy before consuming Enter and test a no-room summary beside a focused control.

2. **HLC-02 — OPEN: Close pinned readouts when their target disappears.** `src/live/NodeBadges.tsx:83`. Queue: #248/#252 r5.
   Pinned ownership is not reconciled when a node/edge is removed. Reconcile against live document IDs, close via the controller and test deletion and undo for both target kinds.

3. **HLC-03 — OPEN: Keep a focused summary mounted while the pointer moves.** `src/live/NodeBadges.tsx:83`. Queue: #248/#252 r5.
   Pointer events can replace the logical target even while its summary holds focus. Make focused ownership explicit and test moving onto another item before Tab/Escape.

4. **HLC-04 — OPEN: Keep readout Tab navigation available in read-only viewers.** `src/canvas/selection/useCanvasNavigation.ts:267`. Queue: #248/#252 r5.
   The editing navigation hook's early guards can exclude the readout path. Route readout traversal before edit-only checks and cover embed and exported viewer forward/backward Tab.

5. **HLC-07 — OPEN: Exclude nodes with no readout from pinning.** `src/live/NodeBadges.tsx:140`. Queue: #248/#252 r5.
   A focusable annotation or unsupported item should not create a hidden logical readout that consumes keys. Check shared readable-target eligibility before opening/pinning and cover inert targets.

6. **HLC-26 — OPEN: Malformed UTF-16 edge IDs.** `src/live/hoverSummary.test.ts:5`. Queue: #250.
   The hover policy should not throw while deriving selectors/readout keys. Exercise lone surrogates through the real edge-card dispatch and choose safe ID handling without changing serialized IDs.

## Batch 2: Section models and placement (5 OPEN)

1. **HLC-05 — OPEN: Build all sections before ranking the pinned verdict.** `src/live/HoverCard.tsx:34`. Queue: #248/#252 r5.
   Summary and pinned section availability can disagree. Build a complete section model first, rank once, and test problems exposed only in expanded details.

2. **HLC-06 — OPEN: Do not call an idle zero-replica worker thread-exhausted.** `src/live/hoverSummary.ts:55`. Queue: #248/#252 r5.
   The comparison busy >= slots classifies 0 >= 0 as exhausted. After the owner health-semantics decision, distinguish an idle scaled-to-zero worker from actual demand without capacity; cover idle, waking and saturated cases without deciding incident policy in this triage.

3. **HLC-08 — OPEN: Resolve default sections against those actually available.** `src/live/verdictSection.ts:1`. Queue: #260 r2.
   A verdict may point to a missing section. Intersect the preferred key with the complete section list and select a valid fallback; test nodes and nonwaiting connections.

4. **HLC-09 — OPEN: Reposition the card when its anchor moves.** `src/live/HoverCard.tsx:93`. Queue: #248/#252 r5.
   The placement effect watches viewport transform and card/root size, but moving the node inside the same viewport need not trigger it. Observe anchor position/revision and test live geometry changes without panning.

5. **HLC-11 — OPEN: Assert visible summary sections inside the clipping container.** `tests/e2e/hover-cards.spec.ts:567`. Queue: #247 final/#255 r3.
   No scrollbar does not prove text is visible. Assert each required section's box stays inside the actual clip region; keep real edge targeting and test a deliberately clipped section.

## Batch 3: Live controls and independent value assertions (5 OPEN)

1. **HLC-10 — OPEN: Prove history cadence before reaching its cap.** `tests/e2e/hover-cards.spec.ts:101`. Queue: #248/#252 r5.
   A ten-entry capped array can pass with the wrong sampling cadence. Use a controlled clock, assert early timestamps/counts and then the bounded ten-entry history.

2. **HLC-12 — OPEN: Prove values change during the geometry-stability regression.** `tests/e2e/hover-cards.spec.ts:147`. Queue: #248/#252 r5.
   A frozen readout can satisfy stable dimensions. Assert a counter/readout change between geometry samples without a time budget.

3. **HLC-13 — OPEN: Keyboard scrubbing commits simulation time.** `tests/e2e/ux-resilience-followup.spec.ts:69`. Queue: #255.
   Roving focus alone does not prove the engine sought. Assert selected event time and controller simulation time after keyboard activation, including backward seeking.

4. **HLC-27 — OPEN: Reselecting On preserves tuned resilience settings.** `src/canvas/inspector/BreakerFields.tsx:37`. Queue: #245/#251 r3.
   A preset assignment can reset existing tuning when reselecting the current mode. Keep settings on no-op selection and test tuned retries/breakers through UI and Undo.

5. **HLC-30 — OPEN: Throughput coverage must distinguish success, requests and attempts.** `tests/e2e/inspector-live.spec.ts:95`. Queue: #260 r2.
   All-success traffic makes those series equal. Use deterministic mixed success/retry traffic and assert the successful rate differs from request/attempt rates before checking the plotted value.

## Closed or superseded findings

| ID     | Status | Finding and current evidence                                                                                                                                                                                                                           | Fixing PR / reason                                       |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| HLC-14 | DONE   | **Escape dismisses unpinned cards** — `tests/e2e/hover-cards.spec.ts:213`. The browser coverage pins dismissal until the originating item is left, without clearing selection first.                                                                   | [#250](https://github.com/latchkostov/diagrams/pull/250) |
| HLC-15 | DONE   | **Red problem text contrast** — `src/styles/live.css:2679`. Problem status uses contrast-safe ink in both themes.                                                                                                                                      | [#250](https://github.com/latchkostov/diagrams/pull/250) |
| HLC-16 | DONE   | **Unavailable rates display an em dash** — `src/live/hoverSummary.ts:57`. Unmeasured request/goodput windows are distinguished from measured zero.                                                                                                     | [#250](https://github.com/latchkostov/diagrams/pull/250) |
| HLC-17 | DONE   | **Running-simulation edge and caller overrides** — `tests/e2e/hover-cards.spec.ts:229`. Connection cards, call pills and node sections share effective simulation policy.                                                                              | [#250](https://github.com/latchkostov/diagrams/pull/250) |
| HLC-18 | DONE   | **Message and dependency cards preserve connection semantics** — `tests/e2e/hover-cards.spec.ts:434`. Non-Request connections omit waiting/retry/thread details; dead letters are retained rather than lost.                                           | [#250](https://github.com/latchkostov/diagrams/pull/250) |
| HLC-19 | DONE   | **Arrow navigation reveals section buttons** — `tests/e2e/hover-cards.spec.ts:243`. Section navigation scrolls the focused button without moving the canvas.                                                                                           | [#250](https://github.com/latchkostov/diagrams/pull/250) |
| HLC-20 | DONE   | **Enter preserves controls inside nodes and cards** — `tests/e2e/hover-cards.spec.ts:544`. The hover override leaves nested control activation intact; dedicated production tests cover the focused section.                                           | [#254](https://github.com/latchkostov/diagrams/pull/254) |
| HLC-21 | DONE   | **Hovering a card preserves canvas-control semantics** — `tests/e2e/hover-cards.spec.ts:507`. Enter pins a hovered readout through the shared ownership policy while editor fields keep their own completion behavior.                                 | [#254](https://github.com/latchkostov/diagrams/pull/254) |
| HLC-22 | DONE   | **Separate focused-summary ownership from pin state** — `src/canvas/interaction/readoutLayer.ts:108`. readout.closed carries hadFocus independently; Escape returns focus without forging pinned=true.                                                 | [#255](https://github.com/latchkostov/diagrams/pull/255) |
| HLC-23 | DONE   | **Share failure-rate semantics across readouts** — `src/live/CallsReadout.tsx:29`. The callout, Calls, connection card and breaker details share settled-attempt failure calculation.                                                                  | [#255](https://github.com/latchkostov/diagrams/pull/255) |
| HLC-24 | DONE   | **Inspector Live heading matches the side-sheet hierarchy** — `src/planning/LiveDetails.tsx:13`. The Option H inspector layout supersedes the small disclosure-row presentation.                                                                       | [#265](https://github.com/latchkostov/diagrams/pull/265) |
| HLC-25 | STALE  | **Legacy latency-tooltip resize-while-open implementation** — `src/live/HoverCard.tsx:92`. The compact NodeBadges tooltip was replaced by the shared HoverCard with ResizeObserver in #250. Track the still-missing anchor-move regression separately. | #171                                                     |
| HLC-28 | DONE   | **Readout keys use the shared ownership policy** — `src/canvas/interaction/readoutLayer.ts:28`. Canvas navigation and Live use the controller's readout layer instead of separate local key dispatch.                                                  | [#250](https://github.com/latchkostov/diagrams/pull/250) |
| HLC-29 | DONE   | **Readout changes do not subscribe the canvas root** — `src/live/NodeBadges.tsx:199`. The readout layer has its own external-store subscription; pointer hover updates that layer independently.                                                       | [#250](https://github.com/latchkostov/diagrams/pull/250) |

## Scope and verification

This is a documentation triage, not an implementation or a new reproduction run. Before taking a batch, recheck its OPEN entries against the then-current master, run the named regression family, and retain any reduced fixture or trace. Tests/CI batches may take separate runner investigations; stop at the bounded evidence step rather than weakening assertions. No application code or output golden changes belong to this triage.
