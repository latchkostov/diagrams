## Engine split (1/5): structural types and readouts

Move the simulation's internal graph types and structural iterators to `src/sim/engine/model.ts`, and its event,
lineage, route, latency and frame/snapshot helpers to `src/sim/engine/accounting.ts`. The facade retains the tick
scheduler, allocation orchestration, lifecycle and checkpoint capture/install order. Function names are preserved
for the parked cohort work.

This is an internal refactor: Live, planning, saved files, replay and the public engine contract are unchanged.
Both parity tiers retain every golden unchanged; none are re-recorded. An import-boundary test rejects phase/facade imports,
including paths through lower-level helpers, type imports, re-exports and dynamic imports.

The source-range map and UX review are in
`docs/design-review/2026-10-25-engine-split-structural-readouts.md`.
