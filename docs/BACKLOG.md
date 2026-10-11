# Backlog

Review findings and ideas not yet scheduled. Remove items when they land.

## From the live view

- Scrub-back: the engine can checkpoint and restore itself, but a saved simulation's runner keeps its
  own state in closures (timeline cursor, traffic and injection credits, burst flags, expectations, the
  current note, the fixed-step scheduler). Restoring only the engine would desync the run, so seeking
  back still restarts and fast-forwards. Needs engine work: `SimulationRun.checkpoint()` /
  `restore()` in `src/sim/simulation.ts`, after which `LiveController.seek` can keep a few
  checkpoints along the timeline and restore the nearest one.

## Your diagrams

- The library lives in `localStorage` (about 5M characters per site). If people keep many large
  diagrams, move documents to IndexedDB and keep only the index in `localStorage`.
- Device file handles (File > Save to a local file) are remembered for the session only; persisting
  them needs IndexedDB too.

## Engine gaps found while modelling real systems

- Layout lint for authors (overlaps, crossings, truncated labels) is in progress via the overlap audit.
