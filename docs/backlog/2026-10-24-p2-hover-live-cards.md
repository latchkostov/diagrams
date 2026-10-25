## P2 triage: Hover and Live cards (2026-10-24)

Initially checked against `origin/master` at `7b6e905130a9`; lane A batch 3 applied on `9ffd474b62ab`. DONE 29 / STALE 1 / OPEN 0 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. Entries retain queue review labels; historical closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. DONE means code and/or the specifically requested regression exists with implementation evidence below; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

Lane A implementation on `fix/p2-hover-live` closed ten entries below. `fix/p2-hover-live-3` closes HLC-06 and batch 3 using the owner's 2026-10-24 current-conditions decision. The closed table's merged-PR evidence remains historical.

## Batch 1: Readout ownership and keyboard traversal (DONE)

1. **HLC-01 — DONE: Require an actually visible card before intercepting Enter.** `src/live/session/useLiveKeyboard.ts:85`. Queue: #247 final.
   The keyboard path checks a logical readout even when placement hides its card. Ask the shared readout visibility policy before consuming Enter and test a no-room summary beside a focused control.
   Resolution (lane A): The hover override now asks the shared placed-card visibility policy before taking Enter from an unrelated focused control. Regression: no-room summary beside Play; deliberate focused-item pinning remains available.

2. **HLC-02 — DONE: Close pinned readouts when their target disappears.** `src/live/NodeBadges.tsx:83`. Queue: #248/#252 r5.
   Pinned ownership is not reconciled when a node/edge is removed. Reconcile against live document IDs, close via the controller and test deletion and undo for both target kinds.
   Resolution (lane A): Ownership is reconciled against current canvas document IDs (including paused Live), closes through the controller, and never restores a pin on Undo. Node/edge deletion-and-Undo browser regressions and focus-policy regressions cover removal after a focused card unmounts.

3. **HLC-03 — DONE: Keep a focused summary mounted while the pointer moves.** `src/live/NodeBadges.tsx:83`. Queue: #248/#252 r5.
   Pointer events can replace the logical target even while its summary holds focus. Make focused ownership explicit and test moving onto another item before Tab/Escape.
   Resolution (lane A): The readout machine records focused ownership independently of pinning. Pointer changes preserve that summary until keyboard traversal or Escape; both paths have browser regressions.

4. **HLC-04 — DONE: Keep readout Tab navigation available in read-only viewers.** `src/canvas/selection/useCanvasNavigation.ts:267`. Queue: #248/#252 r5.
   The editing navigation hook's early guards can exclude the readout path. Route readout traversal before edit-only checks and cover embed and exported viewer forward/backward Tab.
   Resolution (lane A): Tab navigation runs before edit-only shortcut guards, using the existing interaction controller. Browser regressions traverse forward/backward in both an embed and an exported HTML viewer.

5. **HLC-07 — DONE: Exclude nodes with no readout from pinning.** `src/live/NodeBadges.tsx:140`. Queue: #248/#252 r5.
   A focusable annotation or unsupported item should not create a hidden logical readout that consumes keys. Check shared readable-target eligibility before opening/pinning and cover inert targets.
   Resolution (lane A): One readable-target predicate guards pointing, pinning and reverse traversal. Regressions cover annotations, no-simulation stencils and removed IDs; no phantom owner takes Enter/Escape.

6. **HLC-26 — DONE: Malformed UTF-16 edge IDs.** `src/live/hoverSummary.test.ts:5`. Queue: #250.
   The hover policy should not throw while deriving selectors/readout keys. Exercise lone surrogates through the real edge-card dispatch and choose safe ID handling without changing serialized IDs.
   Resolution (lane A): No longer applies to current code: HoverCard already uses opaque React useId IDs (PR #255). Added a real edge-card dispatch regression with lone UTF-16 surrogates, preserving the serialized ID; restoring URI encoding deliberately fails it.

## Batch 2: Section models and placement (DONE)

1. **HLC-05 — DONE: Build all sections before ranking the pinned verdict.** `src/live/HoverCard.tsx:34`. Queue: #248/#252 r5.
   Summary and pinned section availability can disagree. Build a complete section model first, rank once, and test problems exposed only in expanded details.
   Resolution (lane A): The complete pinned section model is assembled before ranking. A down-node regression proves expanded-only Outcomes ranks before compact sections while the compact card retains its three rows.

2. **HLC-06 — DONE: Do not call an idle zero-replica worker thread-exhausted.** `src/live/hoverSummary.ts:55`. Queue: #248/#252 r5.
   Resolution: apply #287's current-conditions semantics, as decided by the owner on 2026-10-24. Exhaustion requires occupied threads. Idle zero-replica workers, waking workers with queued demand, and idle workers with capacity remain neutral for threads; saturated working/waiting pools still warn. Parameterized verdict/vital regressions include historical work and below-capacity occupancy. Removing the positive-occupancy guard fails the idle and waking cases.

3. **HLC-08 — DONE: Resolve default sections against those actually available.** `src/live/verdictSection.ts:1`. Queue: #260 r2.
   A verdict may point to a missing section. Intersect the preferred key with the complete section list and select a valid fallback; test nodes and nonwaiting connections.
   Resolution (lane A): The preferred default is resolved against available sections, with a valid fallback or no section. Node and nonwaiting-connection regressions cover availability; a disappearing Readers section also leaves a fallback that collapses on its first click.

4. **HLC-09 — DONE: Reposition the card when its anchor moves.** `src/live/HoverCard.tsx:93`. Queue: #248/#252 r5.
   The placement effect watches viewport transform and card/root size, but moving the node inside the same viewport need not trigger it. Observe anchor position/revision and test live geometry changes without panning.
   Resolution (lane A): The placement adapter observes node transforms and connection path geometry as well as viewport/card sizes. A browser regression moves an anchor without panning and proves its pinned card follows while keeping focus.

5. **HLC-11 — DONE: Assert visible summary sections inside the clipping container.** `tests/e2e/hover-cards.spec.ts:567`. Queue: #247 final/#255 r3.
   No scrollbar does not prove text is visible. Assert each required section's box stays inside the actual clip region; keep real edge targeting and test a deliberately clipped section.
   Resolution (lane A): Each required summary section is checked against the actual clipping container. A deliberate clipped-section regression proves the check rejects hidden text even when the outer card has no scrollbar.

## Batch 3: Live controls and independent value assertions (DONE)

1. **HLC-10 — DONE: Prove history cadence before reaching its cap.** `tests/e2e/hover-cards.spec.ts:101`. Queue: #248/#252 r5.
   A ten-entry capped array can pass with the wrong sampling cadence. Use a controlled clock, assert early timestamps/counts and then the bounded ten-entry history.
   Resolution: browser checks one, two and three samples before the cap; a mounted HoverHistory unit regression checks values at 0, 999, 1000, 1999 and 2000 ms, the retained last ten seconds and backward seeking. Mutations accelerate sampling, enlarge the cap and disable rewind reset independently.

2. **HLC-12 — DONE: Prove values change during the geometry-stability regression.** `tests/e2e/hover-cards.spec.ts:147`. Queue: #248/#252 r5.
   A frozen readout can satisfy stable dimensions. Assert a counter/readout change between geometry samples without a time budget.
   Resolution: collect throughput alongside each existing geometry sample and require distinct displayed values. Freezing displayed throughput at zero fails the new assertion while retaining the geometry checks.

3. **HLC-13 — DONE: Keyboard scrubbing commits simulation time.** `tests/e2e/ux-resilience-followup.spec.ts:69`. Queue: #255.
   Roving focus alone does not prove the engine sought. Assert selected event time and controller simulation time after keyboard activation, including backward seeking.
   Resolution: assert marker timestamps and the controller-published clock after marker navigation and every native slider key, including backward seeks. Seeking home also restores Payments from its outage. Removing marker seek and removing slider key-up commit are independent failing mutations.

4. **HLC-27 — DONE: Reselecting On preserves tuned resilience settings.** `src/canvas/inspector/BreakerFields.tsx:37`. Queue: #245/#251 r3.
   A preset assignment can reset existing tuning when reselecting the current mode. Keep settings on no-op selection and test tuned retries/breakers through UI and Undo.
   Resolution: the shipped shared Segmented guard already ignores reselection. Browser coverage tunes retry timing and breaker duration, reselects On with click/End and the current retry count, checks the complete persisted policy and verifies the caller edit's coalesced Undo/Redo. Mutations remove the shared no-op guard and replace retry tuning with its preset.

5. **HLC-30 — DONE: Throughput coverage must distinguish success, requests and attempts.** `tests/e2e/inspector-live.spec.ts:95`. Queue: #260 r2.
   All-success traffic makes those series equal. Use deterministic mixed success/retry traffic and assert the successful rate differs from request/attempt rates before checking the plotted value.
   Resolution: 100 requests exhaust three attempts, followed by 100 successful requests. The same ten-second window has 20 requests/s, 2 attempts/request (40 attempts/s) and 10 successes/s. Assert these distinct readouts before the plotted 10/s value. Substituting requests or attempts for successful throughput independently fails the plot assertion.

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

The initial document was a documentation triage. Implementations above retain bounded batch scope and targeted regression/mutation evidence. Batch 3 changes no output goldens, budgets, focus or mode lifecycles; PR CI supplies the full gate.
