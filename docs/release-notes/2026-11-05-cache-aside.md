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

The exact independent sweep passes all 48 runs, including the requested seeds
and heavy multipliers: zero failed and zero unrun. The final complete Linux Dev
suite passes 3,391 cases with zero failed, zero flaky and 56 skipped cases.
The six-worker, six-CPU Inspector and camera load run passes all five repeats:
1,110 passed, zero failed and zero flaky. Earlier Dev concurrency failures and
the bounded clean-master comparison are recorded in the dedicated backlog
fragment; every earlier failed case passes in the final complete Dev run.
The complete Build gate passes all unit, heavy, size and parity checks. Its CSP
walkthrough timeout reproduces on clean master. The separate native-recording
fixture now waits for real encoded output; five targeted repeats pass, and
removing that synchronization fails the regression. The production recorder
is unchanged; the dedicated Build evidence fragment records both failures.

Focused engine, planning, model, copy, saved-simulation and property regressions pass.
Reverted engine, analysis, saved-override, copy, reference-validation and width-rule
controls fail their regressions. The ledger/outcome oracles also cover shared leases,
and replay covers readers joining a refresh after its stale window closes.

All 306 cross-engine digest cases pass in Chromium, Firefox and WebKit. The bundle
and skill preflight passes 217 tests with all existing reserves and ZIP limits.
The largest of the three lease checkpoints is 130,836 B, below the unchanged 130 KiB
bound. The public showcase retains its generated `caching` tag and demonstrates real
hits and misses within ten seconds.

Direct read-through requests and cache-aside callers share the same item lease in
either arrival order, including failures. Refresh observations include both waiter
queues. Analysis keeps a service's cache lookup local even when that cache also has
its own origin, and counts only one total origin demand. Focused thread, replay and
property checks pass; temporarily reverting these fixes fails nine regressions.
Database demand also follows the referenced lookup's traffic share; its two
regressions fail when that propagation is removed. The cache-aside conservation
property additionally passes 4,000 cases across the four requested sweep seeds at
twenty times its usual run count.
Coalesced readers share database pool usage as well as fetches. Analytic pool
ceilings use the fetch share, while blocking thread hold time still uses the miss
share. Both blocking and non-blocking pool regressions fail without that split.
Full parity passes 1,995 Node tests and 112 Linux browser tests: all 3,376 records
are unchanged by this follow-up.

Several database Requests may depend on the same lookup. They run together on a
miss and share one fill after every branch succeeds; a failed sibling prevents a
partial write-back. Coalesced readers wait for that whole group. Properties cover
fan-out, mixed access, cancellation, retries and replay. Temporarily restoring the
old fill handling fails both fan-out regressions and the conservation property.

Database branch records are created only after a miss. Retry and breaker clocks
start at dispatch rather than during the lookup, and completed deferred queues do
not incur repeated empty traversals. A warm hit creates no database bookkeeping.

## Planning work and bundle headroom

Unchanged cache inputs now reuse popularity math while the capacity solver settles
unrelated paths. An operation-count regression grows that path eightfold and
requires cache-math work to remain constant; it fails without this memoization.

Inspector lookup choices index nodes once instead of scanning them for every
connection. An eightfold graph increase stays within the existing linear-work
bound of 24; the old loop grows about 75-fold and fails the regression. Connection
order, current labels and empty-label fallbacks are unchanged. This UI-only
follow-up does not change the simulation runtime tested by the independent sweep.

A same-process comparison bundles clean master and current planner code with the
same Vite production settings, uses the public diagram before and after conversion,
and alternates execution order. Two rounds each discard twelve warm-up pairs and
measure twenty-four pairs. Across all 48 samples, means are 428.048 ms before and
426.046 ms after; the paired median ratio is 1.000572×. Independent medians are
404.198 ms and 410.838 ms. These shared-machine measurements show flat sizing cost
within their variation. Both inputs use four planning runs. Correct sequential
misses change 11,248 ticks / 25,218 messages to 11,253 ticks / 25,485 messages; no
planner limit changes. The earlier oracle-enabled Vitest comparison measured
454.212 ms to 488.211 ms; production bundles omit that test-only oracle code.

The final build measures Live at 123,454 B gzip versus the synced merge-base's
122,094 B: 11,546 B headroom against 135,000 B, including 5,402 B beyond the fixed
6,144 B reserve. The cache runtime is 4,689 B, leaving 431 B below its unchanged
5,120 B cap. Startup is 162,444 B across the same six chunks. All four bundle gates
pass. The PR reports complete Linux gate results.

## Shared-load verification

An initial five-repeat Linux run used six workers on three CPUs and finished with
1,067 passed, 43 failed and zero flaky cases. Both new cache-aside tests passed in
every repeat. Failures were whole-test timeouts in annotations, multi-page Inspector
layout cases and Live accessibility cases; no assertion or timeout was weakened.

The three failing spec files were run twice on a clean `origin/master` snapshot,
`9cb33865770b2b89aebf9c5fc7b5146900e0bca3`, with the same worker and CPU settings.
Its result was 232 passed, 10 failed and zero flaky cases: both annotation cases
failed twice and all six locale/width layout cases failed in the second repeat.
The Live accessibility cases passed there, so they are not claimed as pre-existing.
The follow-up is recorded in
`docs/backlog/2026-11-05-shared-load-ui-timeouts.md`. The PR reports the subsequent
six-worker/six-CPU repeats and full Linux Build and Dev results.

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
