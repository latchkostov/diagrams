# Backlog

Review findings and ideas not yet scheduled. Remove items when they land.

## Your diagrams

- The library lives in `localStorage` (about 5M characters per site). If people keep many large
  diagrams, move documents to IndexedDB and keep only the index in `localStorage`.
- Device file handles (File > Save to a local file) are remembered for the session only; persisting
  them needs IndexedDB too.

## Engine gaps found while modelling real systems

- Layout lint for authors (overlaps, crossings, truncated labels) is in progress via the overlap audit.
