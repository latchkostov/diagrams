## P2 triage: Accessibility and focus (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 25 / STALE 0 / OPEN 0 (deduplicated actionable findings).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. For the historical closed findings, DONE records merged-PR evidence. Batch 1 DONE records the implementation and targeted regression evidence below; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Accessibility and focus (9 DONE)

1. **AF-01 — DONE: Announce blocking drill validation errors.** `src/live/SimPanel.tsx:433`. Queue: #173.
   The invalid-draft message is a plain paragraph, so keyboard and screen-reader users can miss why Save is disabled. Implemented a stable polite, atomic status region, descriptions on Save/Run and field associations. Regression: `fault-drills.spec.ts`, P2 blocking validation, in both themes.

2. **AF-02 — DONE: Explain validation with field names and limits.** `src/live/validate.ts:15`. Queue: #173.
   Some validation still exposes generic errors. Authoring diagnostics now name numeric fields, displayed units and limits, and identify missing targets. Invalid controls reference their own message. Regressions: `src/live/validate.test.ts` and P2 blocking validation in `fault-drills.spec.ts`.

3. **AF-03 — DONE: Retain focus during a pending device wipe.** `src/interop/ui/dialogs.tsx:82`. Queue: #174 r5.
   The queue asks for a held-wipe browser regression; existing dialog tests do not establish the pending handoff. The existing focusable `aria-disabled` control is retained, now with `aria-busy` and disabled opacity. The P2 pending device wipe browser regression holds IndexedDB enumeration, checks keyboard focus, repeated activation, styling and completion.

4. **AF-04 — DONE: Buffer paste during a cold rename.** `src/canvas/interaction/domPort.ts:146`. Queue: #255 r3.
   Naming captures key events while fields load; clipboard insertion needs equivalent ordered ownership. The controller-owned type-ahead capture now orders paste with typing, replaces the selected name and respects editable targets. Regressions: `src/canvas/typeAhead.dom.test.ts` and P2 cold rename paste in `bundle-trim.spec.ts`.

5. **AF-05 — DONE: Release pending rename ownership after remote deletion.** `src/canvas/interaction/controller.ts:163`. Queue: #255 r3.
   A deleted naming target must not keep swallowing keys. The DOM port resolves a deleted naming owner as gone before inspecting the lazy panel. Controller reconciliation releases capture. Unit cases cover nodes, edges and boundaries; the P2 peer deletion browser case proves the next T shortcut opens an annotation before fields arrive.

6. **AF-06 — DONE: Give Next.js a visible interaction accent.** `src/stencils/catalog.ts:1529`. Queue: #246.
   The black brand accent can disappear in dark focus and selection states. Next.js uses a neutral #777777 interaction accent; its branded SVG is unchanged. P2 Next.js browser regressions check real light/dark themes, at least 3:1 accent contrast and axe.

7. **AF-18 — DONE: Announce why peer deletion closes a menu.** `src/collab/room/RoomUi.tsx:46`. Queue: #177.
   The controller can reconcile targets, but users need a reason for the dismissal. The existing bounded canvas status announcement already applies to menus holding focus; no new notification or focus policy is needed. Node and boundary assertions are retained/strengthened and an edge regression is added. Removing the existing announcement fails all three target cases.

8. **AF-19 — DONE: No-tracker recovery must offer a useful action.** `src/collab/room/RoomUi.tsx:1046`. Queue: #190.
   Retry cannot create missing deployment endpoints. No-endpoint builds omit Retry from the alert, connecting failure and chip menu. Hosts keep Save copy and deployment guidance; joiners with no document are told to ask the host for a file and can cancel. The no-trackers browser regression covers both states and axe.

9. **AF-21 — DONE: Latency Shift+Tab respects pending logical focus.** `src/canvas/selection/useCanvasNavigation.ts:192`. Queue: #178.
   Repeated forward/backward navigation can race a scheduled focus handoff. Pending controller targets now include readout cards. Reverse traversal uses that logical card rather than the still-focused DOM node. Unit and fake-clock browser regressions cover queued Tab/Shift+Tab and two reverse steps before advancing frames.

## Closed or superseded findings

| ID    | Status | Finding and current evidence                                                                                                                                                                                                                                                        | Fixing PR / reason                                       |
| ----- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| AF-07 | DONE   | **Custom-injection modal focus and opening race** — `tests/e2e/live.spec.ts:504`. The production modal regression and controller focus handoff cover the reported Nightly failure.                                                                                                  | [#175](https://github.com/latchkostov/diagrams/pull/175) |
| AF-08 | DONE   | **Latency detail access in read-only and presentation views** — `tests/e2e/hover-cards.spec.ts:125`. Pinned details replace the compact tooltip dead end and explicitly omit Properties where unavailable; the later hover redesign in #250 retains this behavior.                  | [#178](https://github.com/latchkostov/diagrams/pull/178) |
| AF-09 | DONE   | **Keyboard context menus and the no-source hint** — `tests/e2e/trace.spec.ts:185`. Shift+F10 and ContextMenu are wired through canvas interaction, including SVG connections.                                                                                                       | [#205](https://github.com/latchkostov/diagrams/pull/205) |
| AF-10 | DONE   | **Escape from Live More returns focus to its button** — `tests/e2e/trace.spec.ts:147`. The owner-approved handoff is implemented through the interaction controller.                                                                                                                | [#205](https://github.com/latchkostov/diagrams/pull/205) |
| AF-11 | DONE   | **Annotation editing keys, insertion focus and shape-picker handoff** — `tests/e2e/annotations.spec.ts:462`. Buffered annotation input and active-gesture resizing are covered through the editor and Lab.                                                                          | [#213](https://github.com/latchkostov/diagrams/pull/213) |
| AF-12 | DONE   | **Window-pane label clearance and narrow Delay geometry** — `src/canvas/shapes/extendedGeometry.ts:40`. Shared visible-outline geometry and label-safe areas replace the original incorrect attachments.                                                                            | [#213](https://github.com/latchkostov/diagrams/pull/213) |
| AF-13 | DONE   | **Forge dark primary-button hover contrast** — `tests/e2e/confluence-forge.spec.ts:1112`. The settings follow-up supplies readable dark-theme hover colors.                                                                                                                         | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-14 | DONE   | **Forge partial-save recovery message** — `tests/e2e/confluence-forge.spec.ts:971`. The settings alert explains an upload that succeeded before settings failed and how to recover it.                                                                                              | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-15 | DONE   | **Forge validation completion respects the focused option** — `integrations/confluence-forge/src/configure.ts:55`. The focus guard preserves size/theme selection and focus outside the iframe.                                                                                     | [#224](https://github.com/latchkostov/diagrams/pull/224) |
| AF-16 | DONE   | **Inner viewer surfaces consume Escape before Maximise closes** — `integrations/confluence-forge/src/view.ts:34`. The modal delegates Escape to the viewer before closing and pauses inline playback.                                                                               | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-17 | DONE   | **Failed Forge Cancel preserves pending work** — `integrations/confluence-forge/src/configure.ts:28`. Loading and validation continue when the host rejects closure; repeated security/types findings are the same defect.                                                          | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-20 | DONE   | **Keep room actions reachable when the chip shrinks** — `tests/e2e/collab-room.spec.ts:985`. A phone-width browser regression opens the named room chip and checks its menu remains usable within the screen.                                                                       | [#182](https://github.com/latchkostov/diagrams/pull/182) |
| AF-22 | DONE   | **Particle hover cursor loads before TraceCard** — `src/styles/live.css:2670`. The pointer affordance moved into Live CSS; a fresh Live visit no longer needs to open the trace first.                                                                                              | [#205](https://github.com/latchkostov/diagrams/pull/205) |
| AF-23 | DONE   | **Forge completion does not restore focus after the reader leaves the iframe** — `tests/e2e/confluence-forge.spec.ts:1063`. Pending save/load failure tests move focus to the parent before completion and assert it stays there.                                                   | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-24 | DONE   | **Rejected replacement keeps the successful Forge upload checkpoint** — `tests/e2e/confluence-forge.spec.ts:986`. The same Insert/Update checkpoint is retried after validation failure; repeated architecture/correctness/security/types review findings describe this one defect. | [#223](https://github.com/latchkostov/diagrams/pull/223) |
| AF-25 | DONE   | **Both shape catalogs share collapsed browsing policy** — `src/canvas/shapes/menu.ts:5`. The rail and palette expose shape leaves through search and keep browsing collapsed without duplicating separate policies.                                                                 | [#213](https://github.com/latchkostov/diagrams/pull/213) |

## Scope and verification

The original entry was documentation triage; Batch 1 was implemented and regression-tested on 2026-10-24. Before taking a batch, recheck its OPEN entries against the then-current master, run the named regression family, and retain any reduced fixture or trace. Tests/CI batches may take separate runner investigations; stop at the bounded evidence step rather than weakening assertions. Batch 1 validation and golden changes are recorded in `docs/release-notes/2026-10-24-p2-accessibility-focus.md`.
