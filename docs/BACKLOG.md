# Backlog

Review findings and ideas not yet scheduled. Remove items when they land.

## Your diagrams

- The library lives in `localStorage` (about 5M characters per site). If people keep many large
  diagrams, move documents to IndexedDB and keep only the index in `localStorage`.
- Device file handles (File > Save to a local file) are remembered for the session only; persisting
  them needs IndexedDB too.

## UX gate 3 (see `docs/DESIGN-REVIEW.md`, round 3)

- P2 At 1024 the gallery's family track scrolls behind a fade. Below 1100px, fold the last families
  into the Vendor menu.

## UX gate 4 (see `docs/DESIGN-REVIEW.md`, round 4)

- P2 The exported PNG has no title, so explainers add a Text by hand. Include the diagram's title and
  description in the image, as presentation does (no new option).
- P2 A text that grows (a bigger size, a longer line) can run over an edge: text isn't a routing
  obstacle. Nudge it clear the way click-to-add placement does.
- P2 With nodes selected, "Annotate ▸ Zone" could draw the zone around them.
- P2 Typing a longer text in the inspector doesn't grow a Text's box (typing in place does).
- P2 At 1024, selecting an annotation near the right edge opens the inspector over half of it; check
  that `useKeepSelectionInView` covers annotations.
- P2 In the Lab (no presentation mode) the Record setup still says "in presentation view".

## Engine gaps found while modelling real systems

- Layout lint for authors (overlaps, crossings, truncated labels) is in progress via the overlap audit.
