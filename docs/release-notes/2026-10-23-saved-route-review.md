## Saved-route review fixes

Saved lines now hold the opening fit, Live refits and image capture until their geometry is available. Live's panel and trace-card fits include saved detours and their labels. One Retry recovers all required edge modules, and downloading dependency details preserves routing caches.

Fixed saved segments are spatially indexed without comparisons against one another; all-fixed drawings skip nudging. Clipboard routes obey the same 64-point and �1,000,000 coordinate limits as native imports and the published schema. Malformed clipboard routes are refused before remapping.

## Output parity

Only the PR-specific `node/skill/corpus-hand-shaped-lines.public-schemas.json` fingerprint is expected to change: the saved-waypoint schema now publishes the coordinate limits already enforced by native loading. Existing diagram, simulation, routing and export outputs must stay unchanged. No golden is re-recorded to accommodate a failure.
