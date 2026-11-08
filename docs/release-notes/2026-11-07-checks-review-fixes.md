## Checks recovery and fixes

Capacity fixes keep whole-diagram request findings when rechecking, so a blocked caller no longer
prevents an unrelated worker from being scaled. The editor forwards target and cancellation options
to the Checks worker. Cancel messages carry only the request ID; replacement readers start fresh
work immediately, including during development StrictMode replay, and abandoned attempts cannot
publish late results.

Properties reuses a lightweight reading-order index across recovered selections. All checks stays
reachable when a target result contains only incomplete-analysis markers. More moves focus to the
first newly revealed finding, including when the final page removes the button.

## Verification and output parity

Each reviewed defect has a regression verified against the old behavior. This fix round changes no
simulation, planning, export, translation or other golden output; no goldens are re-recorded.
The targeted Checks parity run compared 386 goldens with none changed, added, missing or stale.
Windows sweep timeouts and their focused branch/master checks are recorded in
[the follow-up](../backlog/2026-11-07-checks-sweep-timeouts.md).
