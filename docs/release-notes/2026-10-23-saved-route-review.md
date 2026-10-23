## Saved-route review fixes

Saved lines now hold the opening fit, Live refits and image capture until their geometry is available. Live's panel and trace-card fits include saved detours and their labels. One Retry recovers all required edge modules, and downloading dependency details preserves routing caches.

Fixed saved segments are spatially indexed without comparisons against one another; all-fixed drawings skip nudging. Iterative union finding also keeps very large mixed lanes off the call stack. Clipboard routes obey the same 64-point and �1,000,000 coordinate limits as native imports and the published schema. Malformed clipboard routes are refused before remapping.

## Output parity

Only the PR-specific `node/skill/corpus-hand-shaped-lines.public-schemas.json` fingerprint changes: the saved-waypoint schema now publishes the coordinate limits already enforced by native loading. Existing diagram, simulation, routing and export outputs must stay unchanged. No golden is re-recorded to accommodate a failure.

## Bundle boundaries

Saved-route authoring schema and image readiness remain in optional chunks. Runtime waypoint validation shares the existing native-model chunk, avoiding an extra startup request. Bundle and skill ZIP budgets are unchanged.

## Export setup and master refresh

Ordinary image exports still insert their measured header before their first asynchronous yield. Only pending edge modules delay that setup; a regression covers both branches. The branch also retains the latest master changes for bounded message types, lazy node settings and slow-motion controls, one topology compilation per check run, and click/drag connection cancellation.
