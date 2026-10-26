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

All requested surfaces remain within +200 B gzip and total app JavaScript within +1,000 B gzip
against the merge-base. The skill ZIP remains strictly below 835,000 B. Limits and compression
policy are unchanged. [PR #353](https://github.com/latchkostov/diagrams/pull/353) records each
surface's raw/gzip measurements against the final merge-base and the exact ZIP bytes.
