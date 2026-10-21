## Deadline bounds in cyclic request planning

PR #197 review: playback expires calls in a request cycle, but `waitingPlan` only evaluates
deadline bounds during its reverse topological traversal. A cycle with a finite timeout can
therefore still report infinite residence and zero capacity.

Follow up with finite failure-time propagation through cyclic components, including endpoint
latency, parallel fail-fast joins, non-blocking continuations and upstream callers. Keep truly
unbounded cycles infinite, retain linear or near-linear work, and add planning/playback regressions.
This requires a cyclic planning algorithm rather than a small change to deadline scheduling;
the review fix keeps the current planner's cycle behavior.
