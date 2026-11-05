## Look up the cache before calling the database

A Request can now run **Only when Product cache misses**. The caller first looks up
the cache, calls the database on a miss, and fills the item after a successful reply.
Blocking callers keep their thread across both phases. **One fetch per item** shares
a lease across readers; failed and timed-out database calls leave the item empty.

The connection Inspector keeps **When** inside its existing **Request details**
disclosure, with the active condition visible when collapsed. Arabic wording isolates
the cache name. Copying the lookup and database connections preserves their relationship;
a partial copy removes the missing condition and explains why.

Black Friday's Product cache now uses a ten-minute rule over 50,000 Typical items.
Its database Request uses the cache result instead of the old 10% share. The public
`w3-cache-aside` parity corpus covers sequential misses and shared leases.

## Verification

Focused engine, planning, model, copy, saved-simulation and property regressions pass.
Reverted engine, analysis, saved-override, copy, reference-validation and width-rule
controls fail their regressions. The ledger/outcome oracles also cover shared leases,
and replay covers readers joining a refresh after its stale window closes.

All 306 cross-engine digest cases pass in Chromium, Firefox and WebKit. The bundle
and skill preflight passes 216 tests with all existing reserves and ZIP limits.
The largest of the three lease checkpoints is 132,020 B, below the unchanged 130 KiB
bound. The public showcase retains its generated `caching` tag and demonstrates real
hits and misses within ten seconds.

## Planning work and bundle headroom

Unchanged cache inputs now reuse popularity math while the capacity solver settles
unrelated paths. An operation-count regression grows that path eightfold and
requires cache-math work to remain constant; it fails without this memoization.

A same-process comparison uses the public diagram before and after the conversion,
the same final engine, fresh uncached planner invocations, and the repository's
`growth()` sampling. Its fastest warmed samples are 450.108 ms before and 454.051 ms
after (1.008744×); the shared machine also produced samples above 500 ms, so the
0.9% difference is below this run's timing variation. This is a local measurement,
not a new time budget or an isolated hardware comparison. Both inputs use four
planning runs. Correct sequential misses change 11,248 ticks / 25,218 messages to
11,253 ticks / 25,485 messages; no planner limit changes.

Before the final math memo, Live measured 123,122 B gzip versus the 122,084 B starting
baseline: 11,878 B headroom against 135,000 B, including 5,734 B beyond the fixed
6,144 B reserve. Final bundle and complete Linux gate results are reported on the PR.

## Intentional parity inventory

Paths are relative to `tests/parity/goldens/`. The 30 changed records and 18 new
records are limited to Black Friday, the new cache-aside corpus, and contracts.

Black Friday simulation counters now include actual Product cache lookups, hits,
misses and write-back. The database sees measured misses instead of a 10% share.
Sequential replies and the removed share draw change seeded event order, completion
times and selected dead-letter traces; evidence and agent/planning rates follow them.
Native, draw.io, HTML and skill-script records carry the new policy and condition.
All five saved stories keep their existing lessons and assertions.

The new corpus records the drawing and native/interchange forms, analytic hold time
and demand, agent/Checks evidence, and Free play plus miss and lease simulations.
Contract records add `caller.onMiss` (including an explicit null saved override),
its generated reference/schema hashes, and seven English/Arabic strings. Other
languages keep English fallback for those new strings.

### Black Friday records

- `node/planning/black-friday-commerce.json`
- `node/planning-p2/black-friday-commerce.json`
- `node/evidence/black-friday-commerce.json`
- `node/agent/describe/black-friday-commerce.json`
- `node/agent/edit/black-friday-commerce.json`
- `node/exports/native/black-friday-commerce.diagram.json`
- `node/exports/drawio/black-friday-commerce.drawio`
- `node/exports/drawio-meta/black-friday-commerce.json`
- `node/exports/html/black-friday-commerce.light.json`
- `node/exports/html/black-friday-commerce.dark.json`
- `node/skill/scripts/black-friday-commerce.json`
- `node/sim/black-friday-commerce/free-play.json`
- `node/sim/black-friday-commerce/doors-open.json`
- `node/sim/black-friday-commerce/poison-deploy.json`
- `node/sim/black-friday-commerce/partner-quota.json`
- `node/sim/black-friday-commerce/doorbuster-stampede.json`
- `node/sim/black-friday-commerce/edge-deploy.json`
- `node/trace/black-friday-commerce/free-play.mmd`
- `node/trace/black-friday-commerce/free-play.json`
- `node/trace/black-friday-commerce/poison-deploy.dead-letter.mmd`
- `node/trace/black-friday-commerce/poison-deploy.dead-letter.json`
- `node/trace/black-friday-commerce/partner-quota.dead-letter.mmd`
- `node/trace/black-friday-commerce/partner-quota.dead-letter.json`

### Cache-aside corpus records

- `node/planning/corpus-w3-cache-aside.json`
- `node/checks/corpus-w3-cache-aside.json`
- `node/checks-words/corpus-w3-cache-aside.json`
- `node/evidence/corpus-w3-cache-aside.json`
- `node/agent/describe/corpus-w3-cache-aside.json`
- `node/agent/check/corpus-w3-cache-aside.json`
- `node/layout/corpus-w3-cache-aside.json`
- `node/routes/corpus-w3-cache-aside.json`
- `node/exports/native/corpus-w3-cache-aside.diagram.json`
- `node/exports/native-meta/corpus-w3-cache-aside.json`
- `node/exports/drawio/corpus-w3-cache-aside.drawio`
- `node/exports/drawio-meta/corpus-w3-cache-aside.json`
- `node/exports/mermaid/corpus-w3-cache-aside.mmd`
- `node/exports/mermaid-plain/corpus-w3-cache-aside.mmd`
- `node/exports/mermaid-read/corpus-w3-cache-aside.json`
- `node/sim/corpus-w3-cache-aside/free-play.json`
- `node/sim/corpus-w3-cache-aside/misses.json`
- `node/sim/corpus-w3-cache-aside/lease.json`

### Shared contract records

- `node/agent/tools.json`
- `node/skill/corpus-hand-shaped-lines.public-schemas.json`
- `node/skill/public-schemas.json`
- `node/skill/corpus-hand-shaped-lines.files.json`
- `node/skill/files.json`
- `node/skill/validate.txt`
- `node/i18n/catalogs.json`
