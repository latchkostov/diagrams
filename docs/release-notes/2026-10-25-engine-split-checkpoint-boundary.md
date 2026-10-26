## Engine split (2/5): checkpoint boundary

Extract whole-graph checkpoint cloning, prototype and index repair, token ownership and restore orchestration
into `src/sim/engine/checkpoint.ts`. Explicit data-only `CheckpointGraph` and `CheckpointClock` contracts
keep the existing capture lists; positional hooks install the facade roots in the original order.

Live playback, saved formats and checkpoint replay behavior stay unchanged; version policy is unchanged. No semantic
parity golden is changed, added, removed or re-recorded. The generated skill viewer changes implementation
bytes only. The import-boundary guard covers the new module, including transitive type imports.

A focused characterization checks repeated restore identity across broker queues, calls, ledger, lineage,
edges and accounting, and rejects an independent edge-slice clone. The source-range map and UX review are in
`docs/design-review/2026-10-25-engine-split-checkpoint-boundary.md`.

## Artifact size check

Against merge-base `31aa4f4b5`, gzip deltas are +108 B for LiveSession including static imports,
+94 B for simulation, +184 B for the simulation worker, +197 B for the evidence worker, and
+134 B for the platform viewer (+58 B for the Interactive HTML viewer). Total app JavaScript
increases 448 B gzip. All per-surface and total caps remain fixed. The built skill ZIP is
818,065 B, leaving 16,935 B below the strict 835,000 B ceiling.
