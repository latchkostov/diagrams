## Keep fault playback behind Live

Separate fault playback, timeline work checks and cached outage membership from the fault grammar
needed to open diagram files. They now load through the existing lazy Live session boundary;
file validation still loads at startup. No budget was raised and no behaviour or wording changed.

The benchmark's shipped-production bundle step (`pnpm bench:bundle`, without E2E hooks) measured
startup gzip at 177,035 B before and 175,995 B after: 1,040 B saved and 1,005 B below the unchanged
177,000 B budget. Run-result and fault-label messages were already lazy, so moving those would
not address the eager dependency. Bundle regressions guard all three runtime modules; restoring
an eager fault-runtime dependency deliberately fails the startup and canvas checks.

Output parity passes: 2,530 goldens, 0 changed, added, missing or stale. No goldens were re-recorded.
