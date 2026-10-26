## Zone and boundary final review fixes

Align and Distribute accept separate node and boundary selections, convert boundary IDs once at the canvas boundary, and keep all positions in canvas IDs. Valid boundary IDs such as `a` and `group:a` no longer select or overwrite each other. Both the inspector and context menu count outermost selected subtrees: Align needs two operands and Distribute needs three. Moving a nested subtree caches ancestor translations, including stationary ancestors, so deep hierarchies do bounded work.

Boundary and zone radius sliders keep each pointer adjustment or focused keyboard burst in one Undo transaction, including pauses across history merge windows and immediate room commits. Draw.io exports save normalized radius metadata and use absolute rounded-rectangle arc sizes for custom boundary and zone radii; imports restore the metadata for boundaries and annotations. Existing default-radius draw.io exports retain their bytes.

## Intended golden changes

Paths are relative to `tests/parity/goldens/`. These are the only two changed goldens in this fix round.

- `node/exports/drawio/inline-rate-limit.drawio`: records radius 28 for three boundaries and radius 32 for the zone, and applies their absolute arc sizes (56 and 64) to draw.io styles.
- `node/exports/drawio-meta/inline-rate-limit.json`: the export grows by 92 bytes with a new hash; read-back now preserves all four radii instead of silently restoring defaults.

## Regression coverage and choices

Tests cover aliased IDs through both arrangement surfaces, effective subtree availability, complete drag-session descendant exclusion and preserved offsets, radius transactions locally and in rooms, custom/default draw.io radii, and operation growth at 32 versus 256 moving and stationary descendants. Deliberately restoring either ID alias, repeated ancestor scans, moving-member snap candidates, raw selection counts, untagged radius updates, omitted radius imports, or legacy custom-radius styles makes the corresponding regression fail.

Kept the contributor's inspector controls and native range interaction. Rejected mixed-namespace fallback matching because imported IDs can legitimately contain the canvas prefix; rejected rewriting default draw.io styles because existing output must remain byte-identical. Full-suite verification stays with PR CI under the fix-round rule.
