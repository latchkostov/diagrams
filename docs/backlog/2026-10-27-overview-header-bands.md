## Follow-up: Overview zone header bands (own PR)

Removed from PR #363 to land the always-readable node identity fix. Overview currently names zones with
master's plain focus chip at each boundary's top-left corner. It keeps the 5% zone tints, the 3:1 outlines
and the route filtering.

The removed design placed an opaque, wrapped header in a free band inside each zone, or above the zone
when it was full. A reimplementation must close these review findings (`.reviews/20261027-105510-57577`
and `.reviews/20261027-114004-59313`):

- **R-812fb60ed4 / R-9803780ad3:** bounded, near-linear placement for imported diagrams. Use pre-sorted
  obstacles, one sweep per zone, and a shared work budget with a cheap fallback.
- **R-f997a8e48e:** treat previously placed headers as obstacles, so nested zones' headers never overlap.
- **R-3a0bf5c05a:** reserve painted card titles, including Icon-style captions below the node box, not
  only node rectangles.
- **R-e857a5fceb:** bound the whole header text (cumulative line length and line count) before any font
  measurement.
- Focus handling when a header disappears, and every zone kind (boundaries and zone annotations).

Branch `fix/workbench-followups-2` at `6e8daf4ed` has the last band implementation (`src/canvas/overview.ts`)
and its unit tests, as a starting point.
