## Line editing follow-ups from #294

Saved-route nudging now prunes expired interval subtrees even when an earlier saved segment spans the entire track. A balanced interval tree replaces prefix maxima, so disjoint automatic segments behind that saved segment do not cause a quadratic candidate scan. The 512/4,096-segment operation regression measures 24,873/241,711 operations (9.718× for 8× input, below the unchanged 24× limit); the previous index fails that limit.

Both the default spatial grid and deferred track index now use one clustering driver for sorting, pair ownership, fixed-route and same-edge exclusions, overlap thresholds, union-find and group filtering. Shared semantic tests cover both orientations, reversed input, transitive clusters, tolerance/overlap boundaries, fixed-only groups and long intervals.

The indexed nudge regression now checks every automatic pair's separated interior tracks, orthogonality, unchanged endpoints and unchanged saved routes. Returning no indexed clusters fails the new separation assertion; a tolerance-boundary mutation fails the shared-rule tests. Both mutations were restored.

No parity golden is updated. There are no new controls, settings, UI strings or routing semantics. The candidate interface uses numeric IDs directly, avoiding an extra identity map in first-view routing. Bundle limits are unchanged.

## Verification

Targeted geometry tests: 61 passed, one opt-in benchmark skipped. Startup chunk isolation: 25 passed. Full output parity: 3,151 goldens unchanged (zero changed, added, missing or stale); the final affected-output recheck passed 1,566 unchanged goldens, including 95 Linux browser cases. Canvas first-view gzip size is 374,807 B against the unchanged 383,000 B budget, leaving 8,193 B headroom (required floor: 8,192 B). The existing startup/live-session headroom warnings are outside this routing fix. No full gate or broad unit suite is run in this fix round; PR CI is the gate.

The branch was synced onto `4254600f84a77a7be94601c008d73e42be93687e` without conflicts. The final headroom above is measured after sync; the pre-sync measurement was 8,203 B. Both remain above the 8,192 B floor.
