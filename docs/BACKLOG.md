# Backlog

Review findings and ideas not yet scheduled. Remove items when they land.

## From review 20261011-005620 (blocked on in-flight canvas work)

- **P1** `src/canvas/CanvasView.tsx`: navigation cancels pending autosaves and loses edits; flush on
  unmount / example switch / `pagehide`, with an e2e test (switch examples right after an edit).
- **P1** Adopt `src/lib/storage.ts` (safe storage) in canvas autosave and editor prefs.
- **P2** `src/canvas/CanvasView.tsx`: JS viewport animations (fitView / pan to note) ignore
  `prefers-reduced-motion`.

## From the UX gate, round 2 (docs/DESIGN-REVIEW.md)

- **P1** Opening the inspector on selection (below 1680px) narrows the canvas without keeping the
  selection's neighbourhood in view: pan so the selected element and its edges stay visible.
- **P1** "Your diagram" is a single slot. Open and Import replace it without the Undo toast that
  New diagram has; consider a small local library ("Your diagrams") in the picker and start card.
- **P1** The picker's "Your diagram" label doesn't follow title edits until the slot is re-read.
- **P1** While a simulation is open in the editor panel, the live bar's picker still says "Free play".
- **P2** The React Flow attribution sits under the live bar and the first-run hint (bottom centre).
- **P2** The presentation narration card covers neighbouring nodes; prefer free space when there is some.
- **P2** "Story & chaos" in the simulation editor: "Timeline" says what it is.
- **P2** Start-card examples could show a tiny rendered thumbnail instead of three stencil tiles.
- **P2** "Continuous traffic" has different icons in the live ⋯ menu and the right-click menu.

## Phase 4 (queued)

- Inputs & capacity UI: wire the engine's real-unit helpers, live multipliers, replica assignments
  and `analyzeCapacity` into the panel and bottleneck heat map (see docs/PLAN.md).

## From the live view

- Flaky under full parallel e2e load: live.spec "saved simulation … immediate diagram navigation" (passes 51/51 alone). Stabilize waits.
- Scrub-back: engine checkpoint API exists; wire the runner to restore the nearest checkpoint.

- Very dense traffic merges particles into lines: wire `autoScale` when creating a run, or thin
  particles by density (the engine now supplies automatic scale selection).
- Edge labels draw above particles and badges while live.

## Engine gaps found while modelling real systems

- Layout lint for authors (overlaps, crossings, truncated labels) is in progress via the overlap audit.
