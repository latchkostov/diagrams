## Native Windows full-catalog accessibility scan

Nightly 41188667639 (`5dc578b09`), Windows shard 5, times out the dark-theme stencils accessibility case at its unchanged 30-second test backstop. The trace shows the new entrance wait returning in about 154 ms, then Axe's partial scan taking roughly 16 seconds and its final merge roughly 9 seconds. This is not a wait stuck on the entrance animation. The scan retains every WCAG tag and its original full-page scope.

This remains unresolved, not a proven platform impossibility or proven clean-master failure. Investigate full-catalog scan/serialization cost and any application rendering contribution while preserving the complete accessibility coverage. Do not raise the test budget, disable rules, reduce the scope, skip or quarantine the case to turn this result green. The exact run and remaining native groups are tracked in PR #403.
