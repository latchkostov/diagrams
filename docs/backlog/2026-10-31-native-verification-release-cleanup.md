## Cause

Nightly 41214488722, Windows shard 4, times out in the new held-scenario agreement regression. Its trace starts at 688480.964, completes the final autoscaling-plan text assertion at 717493.184, then finishes a redundant cleanup `evaluate` at 719170.493, across the unchanged whole-test deadline. The real thread verification and scenario sizing replies had already been awaited, and every behavior assertion passed. Cleanup was sending a second browser operation for an already released request.

## Repair and regression

Cache the release promise in the Node fixture. The normal path and finally block share that operation, including while it is pending or rejected. Cleanup still drains the opening helper; no behavior assertion, timeout, planner work or trend sample changes.

The operation-count regressions cover concurrent release, completed release and failed release. Temporarily removing the cache fails both new cases with duplicate release operations; the restored verification probe passes all ten units. The complete owner spec passes 12 executions each on native Windows and Linux across two repetitions; loaded Linux passes all 30 across five repetitions at eight workers and four CPUs. Build, size, 40 units including 30 startup/reserve heavy cases, and all 3,178 unchanged parity goldens pass.
