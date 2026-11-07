## Lite plugin: import validation and shared knowledge

Opening a diagram lays it out only when x or y is absent. Present but invalid coordinates still
produce the existing import error. Duplicate node IDs and node/boundary ID clashes retain distinct
positions and boundary membership after validation repairs their identities.

The lite knowledge generator now reads explicit named regions from the full skill and refuses
missing, duplicate or reversed markers. The HTML skill tests use the moved full-plugin scripts.
The reviewed skill-page hash now accepts the intended `livediagrams-full@livediagrams` install
command; the page itself is unchanged in this fix.

Parity: `node/skill/files.json` intentionally changes only its `SKILL.md` fingerprint for the new
shared-region markers. Diagram, layout, simulation and export output goldens are unchanged.
