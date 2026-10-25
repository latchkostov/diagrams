## Performance tooling and collaboration work counts

Bundle comparisons now build a changed-lock merge-base with its own frozen dependencies, cached by
lockfile SHA-256, Node version, platform and architecture. Identical lockfiles keep the zero-install
path. Complete cache entries retain their installation paths so pnpm's Windows junctions remain valid.
Real local dependency resolutions prove version 1 remains the baseline when HEAD installs version 2;
a repeated measurement reuses the same installation.

Dev skill viewer/file requests now share fresh files independently of the ZIP cache. Compression runs
only for an explicit ZIP download; ordinary files and the viewer remain available while it is pending.
Source changes invalidate both caches, and failed ZIP downloads can retry.

`pnpm exec node scripts/bench/skill-dev.mjs` isolates the skill plugin in an empty Vite server root
without dependency discovery, using the same committed viewer to exclude compilation. Three HTTP
requests each invalidate the plugin caches first. On this Windows/Node 24.22.0 worktree, sequential
before/after runs measured:

| Measurement   | Before      | After    |
| ------------- | ----------- | -------- |
| Server listen | 10.12 ms    | 9.30 ms  |
| Cold viewer 1 | 6,677.45 ms | 35.46 ms |
| Cold viewer 2 | 7,634.24 ms | 24.27 ms |
| Cold viewer 3 | 7,658.67 ms | 43.67 ms |

These are observations, not test timing budgets. The regression holds compression explicitly and
asserts completion of viewer/file responses without releasing it. Production compression is unchanged:
the skill ZIP is byte-for-byte identical at 831,669 B (cap: 835,000 B), SHA-256
`428f55418e02695ffce0a11233d4d331a5a5dbfd1dd2efe1f6f5d5b239a9e319`.
No output goldens change and no bundle budget changes.

Collaboration tests now count document and presence work separately at eightfold input sizes.
Projection at 64/512 nodes costs 836/5,764 operations (6.90×); presence at 8/64 peers costs 25/247
(9.88×), including its existing display ordering. Each retains the 24× growth limit. A real edit
invalidates projection before measurement and must reread exactly one record. Temporarily replacing
document membership indexing and presence traversal with nested scans makes each assertion fail.

P-05 bundle trims remain outside this tooling change.
