# Backlog

Review findings and ideas not yet scheduled. Remove items when they land.

## Your diagrams

- The library lives in `localStorage` (about 5M characters per site). If people keep many large
  diagrams, move documents to IndexedDB and keep only the index in `localStorage`.
- Device file handles (File > Save to a local file) are remembered for the session only; persisting
  them needs IndexedDB too.

## UX gate 3 (see `docs/DESIGN-REVIEW.md`, round 3)

- P1 The bottleneck callout is a static plan: with Payments down on the timeline it still says
  "Healthy: every service has headroom". Account for nodes that are down or paused in the run.
- P2 Timeline markers (notes, chaos) aren't clickable. Presenters could jump to one with a click.
- P2 On a blank diagram "Untitled diagram" shows three times: picker, title card and inspector. The
  title card could wait for the first node.
- P2 The diagram card's node and edge counts repeat the inspector's.
- P2 Your diagrams always shows the storage meter. It could wait until storage is half full.
- P2 At 1024 the gallery's family track scrolls behind a fade. Below 1100px, fold the last families
  into the Vendor menu.
- P2 The narration card can cover dimmed, unfocused nodes. Prefer free space (from round 2).

## Engine gaps found while modelling real systems

- Layout lint for authors (overlaps, crossings, truncated labels) is in progress via the overlap audit.

## Test health
- `live.spec` "Lab presets render the live view" can time out under full parallel load (passes alone). Split it per preset or lighten the presets so the suite is reliably green.
