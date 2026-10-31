## Hover-card regression readiness

The deletion and Undo browser tests wait for the Live camera to finish its opening
layout before clicking a connection. They target its exposed stroke, pin through
the named card header, and wait for the restored target's layout before hovering.
The edge cases also exercise slower rendering with 4× browser CPU throttling.

The quick-add readiness wait from #392 remains in place; temporarily removing it
reproduces the reported missing-highlight failure. No application behavior or
output is intentionally changed. Output parity checks 3,178 goldens with zero
changed, added, missing or stale; no golden is re-recorded.

The six targeted cases pass 30 repetitions each under Linux CPU load (180/180);
both complete specs also pass twice (114/114). The CI evidence and the limits of
the local before/after measurements are recorded in the flake-fixes backlog.
