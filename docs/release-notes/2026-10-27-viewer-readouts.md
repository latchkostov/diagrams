## Viewer and export readouts

Restore the status, fleet and numeric badge attributes in production viewers, Interactive HTML
exports and the agent skill. These artifacts deliberately disable E2E hooks, so the new E2E-only
attribute guard removed the observability used to verify playback. The memo comparator now tracks
all restored values; leaf memoization and immutable per-broker peak observations remain intact.

The Overview regression reaches the same zoom with one wheel gesture instead of fourteen toolbar
clicks, preserving its silhouette, Inspector and viewport assertions within the existing backstop.
No output goldens were changed.
