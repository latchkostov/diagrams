## A readable large Live Overview

Zoomed-out Live Overview now names service tiles at a 10.5 px screen-space text floor. Crowded boundaries become named aggregates with the exact number of collapsed services; tiles without room for a name disappear. Selecting a boundary header focuses its services, where individual selection still opens Properties. Spotlight names and the focus hint remain visible.

Boundary and zone titles have their own internal header bands. Regions use a 5% tint and stronger outlines. Live Overview draws only narrated-near connections and the existing top quartile by current delivery rate, at 1.5 screen pixels. Saved geometry, simulation results and exports keep their existing behavior.

The only intended golden change is `tests/parity/goldens/node/i18n/catalogs.json`: every language's camera-area hash and English-fallback count include the new plural-aware aggregate message. Untranslated languages use the English fallback. No simulation, planning, routing, layout or export golden changes are intended.
