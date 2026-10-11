# Backlog

Review findings and ideas not yet scheduled. Remove items when they land.

## From review 20261011-005620 (blocked on in-flight canvas work)

- **P1** `src/canvas/CanvasView.tsx`: navigation cancels pending autosaves and loses edits; flush on
  unmount / example switch / `pagehide`, with an e2e test (switch examples right after an edit).
- **P1** Adopt `src/lib/storage.ts` (safe storage) in canvas autosave and editor prefs.
- **P2** `src/canvas/CanvasView.tsx`: JS viewport animations (fitView / pan to note) ignore
  `prefers-reduced-motion`.

## From the design review (docs/DESIGN-REVIEW.md)

- P1 Inspector density, "1 boundaries" plural, node id as copy chip.
- P1 One label style (sentence case) for Lab and menu headers.
- P2 Drop native `title` tooltips on canvas nodes; empty-canvas hint should match palette state.

## Phase 4 (queued)

- Inputs & capacity UI: wire the engine's real-unit helpers, live multipliers, replica assignments
  and `analyzeCapacity` into the panel and bottleneck heat map (see docs/PLAN.md).

## From the live view

- Flaky under full parallel e2e load: live.spec "saved simulation … immediate diagram navigation" (passes 51/51 alone). Stabilize waits.
- Scrub-back: engine checkpoint API exists; wire the runner to restore the nearest checkpoint.

- Lint: repo-wide `eslint .` errors remain (CanvasView, useHistory, useEditor, …); fix in the cleanup pass.
- Very dense traffic merges particles into lines: wire `autoScale` when creating a run, or thin
  particles by density (the engine now supplies automatic scale selection).
- Edge labels draw above particles and badges while live.

## Engine gaps found while modelling real systems

- Layout lint for authors (overlaps, crossings, truncated labels) is in progress via the overlap audit.
