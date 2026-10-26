## Checkpoint boundary: source map and UX review

Against PR 1 (`31aa4f4b5`), the checkpoint/restore block is `src/sim/engine.ts:3953-4114`.

| Original concern                                                                               | Destination                                                                                 |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Whole-graph clone, shared trace recordings and copy-on-write latency                           | Module-local `cloneGraph` in `src/sim/engine/checkpoint.ts`                                 |
| Per-engine token scope, topology validation and repeated restore                               | `createCheckpoints` in `src/sim/engine/checkpoint.ts`                                       |
| Queue prototypes, null-prototype dictionaries, stable node/edge containers and indexes         | Module-local `repair` in `src/sim/engine/checkpoint.ts`, with the existing group-index hook |
| Graph and scalar capture lists                                                                 | Typed positional read hooks in `src/sim/engine.ts`                                          |
| Closure-root assignment, admission reconstruction, RNG position and configuration invalidation | Positional installation hook in `src/sim/engine.ts`                                         |

No functions or fields are renamed, so the parked cohort work retains its current names. The clone still
traverses one graph; it never clones individual ownership slices separately. Restore keeps budget assignment,
node repair, group indexing, edge installation, root replacement, admission rebuilding, clock installation,
RNG reset and configuration invalidation in the same order. Stable containers are bound once; mutable
replaced roots are always read or installed through hooks. Helpers stay module-local unless they form the seam.

There are no new controls, terminology, examples or presentation changes. The chrome budget and progressive
disclosure are unaffected. Live must show the same particles, traces, counts, latency and replay after restore;
output parity and the replay anchors protect this behavior. A public showcase would add unrelated output to
this extraction, so none is added.

Rejected: per-slice serialization (breaks aliases), named port objects (retain shipped property names), a
broad mutable engine context (hides captured state), checkpoint-format/version changes, scheduler changes,
and cohort algorithm fixes (prevent a mechanical equivalence review).
