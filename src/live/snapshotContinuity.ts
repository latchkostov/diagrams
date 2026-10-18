import type { SimSnapshot } from "../sim/types";

// Presentation metadata only: it never enters snapshots' serialized simulation output.
export const snapshotContinuity = new WeakMap<SimSnapshot, object>();
