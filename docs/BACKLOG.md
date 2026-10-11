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
- Inputs & capacity: real units with sampled dots, replicas, Traffic × / Capacity ×, partition-idle
  consumers, analytic bottleneck heat map (see docs/PLAN.md).
