## PR #293: badge readout host regression

Readout ownership only needs an edge index when a canvas interaction layer exists. Skipping that
subscription without a host preserves badge rendering and avoids unrelated graph work.

No controls, text, layout, focus rules, or visual output change. Keep the existing health-window and
idle-pill assertions instead of expanding their fixtures to hide the dependency. All 40
production-build hover-card tests pass, including readout removal and keyboard traversal.
