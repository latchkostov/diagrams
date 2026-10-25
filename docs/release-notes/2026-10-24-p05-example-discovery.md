## Example discovery downloads on demand

The start card keeps clickable titles and short summaries available while its thumbnails download.
The examples browser keeps its search, feature filter and Close/Esc shell available while the shared
`examples.discovery` surface loads the unchanged discovery body. One shared Retry recovers a failed
download without losing the query. Discovery skips export readiness and cannot delay Live or recording.

Candidate D's DEV/E2E tutorial metadata guard was already present after syncing master (`58032de3`).
This change pins its production absence and retains preview hold/failure/retry/cancellation coverage.
Candidates B and C are outside this batch. No public example content or budget was trimmed or raised.

## Measured gzip bytes

Node 24.22.0, pnpm 12.11.2, gzip level 9, ordinary production builds without `VITE_E2E`;
`E2E_GATE=1` retains the public-only build filters. Before is the synced analysis tree `f7c894df`.
Both app measurements use that same build revision while comparing the implementation working tree.
Commands: `pnpm build`, `pnpm size`, then `BENCH_BASELINE_ONLY=1 node scripts/bench/bundle.mjs`.
Viewer totals count each JS/CSS/font manifest asset once; Forge totals come from its resource check.

| Entry/resource                   | Fixed limit B | Before gzip B | Before headroom B | After gzip B | After headroom B | Delta B |
| -------------------------------- | ------------: | ------------: | ----------------: | -----------: | ---------------: | ------: |
| Main entry                       |       123,500 |       107,930 |            15,570 |      107,954 |           15,546 |     +24 |
| startup                          |       177,000 |       170,784 |             6,216 |      159,240 |           17,760 | -11,544 |
| canvasFirstView                  |       383,000 |       374,770 |             8,230 |      363,738 |           19,262 | -11,032 |
| Live, additional to canvas       |       135,000 |       130,135 |             4,865 |      130,127 |            4,873 |      -8 |
| Platform viewer JS/CSS/fonts     |       805,000 |       629,418 |           175,582 |      629,422 |          175,578 |      +4 |
| Forge, both resources/all assets |     1,020,000 |       914,469 |           105,531 |      914,471 |          105,529 |      +2 |

Startup exceeds its required 8,192 B reserve by 9,568 B; canvas exceeds its required 16,384 B reserve
by 2,878 B. The entry/independent-build changes include adapter and emitted graph/compression overhead;
no viewer or Forge saving is credited. Forge raw bytes: 2,656,384 → 2,656,396 of 5,000,000 B
(headroom 2,343,616 → 2,343,604 B). Live still needs its separately scoped reserve work.

## Output parity and regression proof

`pnpm parity`: 3,151 goldens; 0 changed, 0 added, 0 missing, 0 stale. There are no changed golden
files to explain. Rows, order, thumbnails, descriptions, feature tags and post-load keyboard behavior
are preserved. No new showcase is needed for a payload-ownership change.

Mutation check: temporarily importing/reading rich metadata in the eager start shell makes
`src/examples/discovery.test.tsx` fail (`idle` instead of the required held `loading` surface).
Restoring the lazy boundary passes. The browser contracts additionally hold the real production chunk,
keep row geometry/focus, preserve typed queries, cancel before completion, retry failures, download
model/image/Interactive HTML files and start Live/recording without releasing discovery.
