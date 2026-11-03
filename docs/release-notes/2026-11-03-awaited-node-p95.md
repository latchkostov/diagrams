## Awaited-node latency expectations

Fixed R-f593fd1659: completed awaited service and database requests now contribute to `p95`
expectations. Each sample measures service time at that node from arrival to reply, including
local queue/work, downstream waits and reply continuation work. A slow client → service → database
chain now fails tight latency expectations at both awaited nodes.

The new aggregate-only recorder has 128 fixed buckets per measured non-caching node and is
captured with copy-on-write checkpoint isolation. Source response timing, non-cache hover/dock
readouts, async latency, cache aggregates, traces and Checks retain their existing semantics.
No goldens are changed or re-recorded in this round; this adds no changes to the PR's already
approved golden differences.

## Regression and checkpoint evidence

The slow-chain regression measures 500 ms at the database and 850 ms at the service, including its
150 ms reply continuation. Removing awaited response recording fails all three regressions.
Coverage also checks local admission wait, in-flight restore, exact replay, fault-window reset and
restart. Two aggregate response recorders add 2,432 B after 101 completed requests each.
The full warm cache fixture remains at a 124,800 B increment (156,504 B checkpoint, 31,704 B
baseline), below the unchanged 133,120 B bound; the cold full-ring increment is 99,897 B.
