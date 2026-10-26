## Zone and Boundary UI/UX improvements

Adds corner radius customization, smart snapping, and multi-selection alignment for zones and boundaries:

- **Border radius slider:** Boundary and Zone inspectors now expose a `Border radius` slider control (0–40 px) beneath the size controls, mapped to canvas renderers (`--grp-radius` for SVG boundary cards, `--ann-radius` for zone containers). Preserves radius during zone-to-boundary and boundary-to-zone conversions.
- **Reusable Slider component:** Created `Slider.tsx` in `src/components/` with accessibility attributes, numeric feedback, full keyboard support, and dedicated unit tests.
- **Boundary alignment & distribution:** Boundaries can now be aligned (left, right, center, top, bottom, middle) and distributed alongside nodes and zones. Moving or aligning boundaries shifts all contained descendant nodes and nested groups by the same delta.
- **Smart guides for backdrops:** Zones and boundaries now participate in smart guides on canvas, aligning edges and centers with nodes and other backdrop elements during dragging.
- **Empty zone labels & handle:** Zone labels can now be emptied without falling back to the placeholder word "Zone". An interactive top strip drag handle is maintained when empty so users can still select and move the zone.

## Golden inventory

- Updated `node/i18n/catalogs.json`: Added `inspector.borderRadius` translation key.
- Updated `node/skill/corpus-hand-shaped-lines.public-schemas.json` and `node/skill/public-schemas.json`: Generated JSON schemas reflect the new optional `borderRadius` property.

Every other golden is unchanged.
