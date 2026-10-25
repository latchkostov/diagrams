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
`E2E_GATE=1` retains the public-only build filters. Before is clean master
`3234a45b07e1caeb2c7670e6da4857ef6725a809`; after is the rebased implementation `f49b7a8c`.
Commands: `pnpm build`, `pnpm size`, then `BENCH_BASELINE_ONLY=1 node scripts/bench/bundle.mjs`.
Viewer totals count each JS/CSS/font manifest asset once; Forge totals come from its resource check.

| Entry/resource                   | Fixed limit B | Before gzip B | Before headroom B | After gzip B | After headroom B | Delta B |
| -------------------------------- | ------------: | ------------: | ----------------: | -----------: | ---------------: | ------: |
| Main entry                       |       123,500 |       107,944 |            15,556 |      107,956 |           15,544 |     +12 |
| startup                          |       177,000 |       170,798 |             6,202 |      159,242 |           17,758 | -11,556 |
| canvasFirstView                  |       383,000 |       374,802 |             8,198 |      363,790 |           19,210 | -11,012 |
| Live, additional to canvas       |       135,000 |       130,135 |             4,865 |      130,139 |            4,861 |      +4 |
| Platform viewer JS/CSS/fonts     |       805,000 |       629,417 |           175,583 |      629,421 |          175,579 |      +4 |
| Forge, both resources/all assets |     1,020,000 |       914,471 |           105,529 |      914,473 |          105,527 |      +2 |

Startup exceeds its required 8,192 B reserve by 9,566 B; canvas exceeds its required 16,384 B reserve
by 2,826 B. Entry and independent-build totals include adapter and emitted graph/compression overhead;
no viewer or Forge saving is credited. Forge raw bytes: 2,656,389 → 2,656,401 of 5,000,000 B
(headroom 2,343,611 → 2,343,599 B). Live reports 19 additional chunks in both builds, but its measured
wire total rises by 4 B. It still falls short of the warning floor; no Live saving is claimed and no
extra trim scope is added to compensate for that result.

## Output parity and regression proof

`pnpm parity`: 3,151 goldens; 0 changed, 0 added, 0 missing, 0 stale. There are no changed golden
files to explain. Rows, order, thumbnails, descriptions, feature tags and post-load keyboard behavior
are preserved. No new showcase is needed for a payload-ownership change.

Mutation check: temporarily importing/reading rich metadata in the eager start shell makes
`src/examples/discovery.test.tsx` fail (`idle` instead of the required held `loading` surface).
Restoring the lazy boundary passes. The browser contracts additionally hold the real production chunk,
keep row geometry/focus, preserve typed queries, cancel before completion, retry failures, download
model/image/Interactive HTML files and start Live/recording without releasing discovery.

## Validation limits

The requested Chromium families passed 178 cases with one existing `live.note` fixme skipped;
examples and production bundle contracts passed 115 tests. Nine synthetic-registry dev cases passed
after their fixtures were aligned with the compact identity contract. The added public-title assertion
fails when a fixture still reads identity from the rich module.

The five-repetition Linux neighbour run recorded 1,910 passed, 10 failed, zero flaky and five existing
skips. Five failures were the same inspector Escape case, also reproduced on clean master; see the
[inspector follow-up](../backlog/2026-10-24-p05-inspector-held-escape.md). Five HTML artifact timeouts
appeared only in repetition two and did not reproduce in the limited clean-master check or in a
subsequent five-repetition, eight-worker HTML run (70 passed). They remain an
[unreproduced observation](../backlog/2026-10-24-p05-html-download-stress.md), not a claimed fixed defect.
