## R-3bfcf5e118: route visibility after live ranking changes

PR 363 round 1 leaves this P2 coverage follow-up: promote and demote routes after Overview settles,
assert updated visibility and retention of narrated-near routes, and assert zero geometry measurements.
The existing paused-frame visibility and settled-measurement tests exercise these separately; joining
them requires a playback/ranking fixture beyond a one-line fix. Keep the current assertions intact.
