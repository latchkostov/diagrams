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

## From the live view
- Injecting at a `sink` with outgoing edges (e.g. a partner system that both receives and sends) goes
  nowhere; injection should emit along outgoing edges like a source.
- `engine.snapshot()` copies ~200 events per frame; add a cheap particles/nodes accessor for rendering.
- URL rewrites (presentation toggle) drop `live`, `sim`, `speed`, `paused`, `traffic`.
- Scrub-back replays from zero each step (slow on long simulations): keep periodic engine checkpoints.
- Very dense traffic merges particles into lines: auto-raise `scale` (phase 4) or thin particles by density.
- Edge labels draw above particles and badges while live; live context menu exceeds the 12-item budget.
