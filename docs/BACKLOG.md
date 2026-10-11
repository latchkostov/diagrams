# Backlog

Review findings and ideas not yet scheduled. Remove items when they land.

## Your diagrams

- The library lives in `localStorage` (about 5M characters per site). If people keep many large
  diagrams, move documents to IndexedDB and keep only the index in `localStorage`.
- Device file handles (File > Save to a local file) are remembered for the session only; persisting
  them needs IndexedDB too.

## Engine gaps found while modelling real systems

- Layout lint for authors (overlaps, crossings, truncated labels) is in progress via the overlap audit.

## Live view and trace (UX gate 5)

- A narration close-up (e.g. Poison invoices at 1440) crops nodes at the left under the rail and the
  zoom controls; the note fit only guarantees the focused nodes.
- A node's badge can sit on an edge label (Azure: "29 queued" over "After 5 failed deliveries").
- At 1440 a 13-participant sequence diagram scrolls sideways (fitting would take 63%, too small to read).
  A "whole journey" zoom could help presenters, if anyone asks.
- In presentation at 1920, wide diagrams show node titles at about 9 px; a camera that follows the traced
  path would read better at a distance.
- Trace card hop rows truncate "as PaymentCompleted" at 352 px.
