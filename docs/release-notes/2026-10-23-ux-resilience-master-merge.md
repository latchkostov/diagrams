## Resilience UX integration with message types and connection editing

Merged master into PR #255, preserving the lazy Messages inspector, edge message reader,
Live label hover handling and connect-to-dot alongside the resilience inspector and readout changes.
Saved simulation timelines now load on demand with their space reserved while downloading;
Live controls remain available. The skill ZIP uses additional lossless DEFLATE blocks to retain
the existing 835,000-byte download limit. No bundle budget was raised.

The only regenerated parity golden is `node/i18n/catalogs.json`: the combined catalog has
2,903 messages instead of master's 2,881, with the resilience, hover and example copy retained.
Locale fallback counts and the affected area fingerprints follow those English additions and edits.
No diagram, simulation, layout, export or image golden was re-recorded. Generated skill files
started from master's versions and were regenerated from the merged sources.
