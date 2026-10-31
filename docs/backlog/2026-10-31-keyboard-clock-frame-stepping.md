## Bounded clock stepping for keyboard notes

The scheduled-note regression exposed a harness problem under Linux load: runFor executes every animation frame for each simulated second, and the polling backoff adds real time while a paused browser clock cannot advance. The note was still at 6.3 simulated seconds when the unchanged visibility deadline expired. The canonical command-palette Live action also avoids an unrelated Tab traversal during regression setup.

The note wait now fast-forwards one existing CATCH_UP_MS frame at a time and polls without backoff, stopping on the real Continue control. The engine still reaches the actual pausing note and the exact waiting-state assertion. No timeout, budget, simulation value or predicate changes. Linux under load: the previous frame-by-frame paused regression failed 3/5; bounded frame jumps pass 5/5. The original visibility-only negative control remains a failure. No golden changes are expected.
