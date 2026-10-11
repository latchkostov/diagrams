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
- Flaky under full parallel e2e load: live.spec "saved simulation … immediate diagram navigation" (passes 51/51 alone). Stabilize waits.
- Scrub-back: engine checkpoint API exists; wire the runner to restore the nearest checkpoint.

- Lint: repo-wide `eslint .` errors remain (CanvasView, useHistory, useEditor, …); fix in the cleanup pass.
- Injecting at a `sink` with outgoing edges (e.g. a partner system that both receives and sends) goes
  nowhere; injection should emit along outgoing edges like a source.
- `engine.snapshot()` copies ~200 events per frame; add a cheap particles/nodes accessor for rendering.
- Very dense traffic merges particles into lines: auto-raise `scale` (phase 4) or thin particles by density.
- Edge labels draw above particles and badges while live.

## Engine gaps found while modelling real systems

- **Bug:** DLQ inference by label (`/dlq|dead.?letter/`) can't be opted out; a consumer whose sublabel says
  "no DLQ" became a dead-letter path and stopped all flow. Support `props.dlq: false` and only infer for
  edges leaving brokers into broker/store targets.
- Retries go to the back of the group's queue, so "N retries then DLQ" only happens with short backlogs.
  Add retry modes: in-place (blocking) vs. requeue, with optional backoff ms.
- Probabilistic split: let an edge carry a fraction of traffic (`props.share: 0.35`, e.g. "35% open the
  email") instead of modelling ratios as separate traffic profiles. Fits phase 4.
- Layout lint for authors (overlaps, crossings, truncated labels) is in progress via the overlap audit.
