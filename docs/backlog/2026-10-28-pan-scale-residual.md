## Remaining large-diagram pan and drag cost

The pan-scale measurements on the 1,500-node public pipeline still miss the 30 ms/step target. Pointer capture
and membership-based Live badge updates reduce work, but React Flow's graph-only store subscribers still wake
on viewport transforms, and Chrome still paints and updates layers proportional to retained drawing complexity.
The measurements and rejected prototypes are in `docs/design-review/2026-10-28-pan-scale.md`.

Investigate filtering viewport-only notifications to graph-only subscribers through supported React Flow APIs,
and browser paint/display-list retention. Preserve the complete DOM, off-screen accessible names, first-frame
identity, moving zone labels, low-zoom chips, Follow and keyboard navigation. Whole-viewport compositing and
per-part promotion regressed in the local prototypes and should not be adopted without new evidence.

Node drag at 1,500 also remains open. Its trace points to decoration/grow-chip geometry on release, routing and
per-node subscriptions. A session-metadata cache and chip-wrapper shortcut did not clear the 10% threshold and
were removed. Keep output goldens, entry budgets and canvas/Live reserves fixed.
