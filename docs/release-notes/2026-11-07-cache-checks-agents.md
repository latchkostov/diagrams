## Caching Checks and agent parity

Checks now explain harmful hot-item expiry (`cache-stampede`), cold-origin overload
(`cache-cold-start`), items expiring before reuse (`cache-ttl-short`) and rules matching
non-cacheable methods (`cache-method`). A bounded Cold cache probe purges at 5 s and plays to
20 s at configured rates. Skipped probes are reported as `notChecked.cache`, never all clear.
Policy fixes and their alternatives need same-seed evidence; freshness changes stay explicit.

Agents describe cache demand and capabilities, receive the same Checks descriptors and ordinary
edit operations, and author purge Drills. Adding cache rules to W2 upgrades atomically to W3;
older models and incapable stencils refuse the edit. Both plugin channels document W3 defaults,
rules, cache-aside, purges, item-fetch metrics and modelling limits from one source.

## Expected golden changes

- Checks rule inventories and About copy gain the four caching rules across the corpus.
- The small stampede example gains two warnings and their fixes/options; related Checks words,
  agent checks, fix rechecks and evidence reflect those findings. The W3 cache-aside corpus gains
  a latency-backed stampede warning. Black Friday has zero findings and explicitly reports one
  cache left unprobed within the existing work budget.
- Agent tool schemas describe the cache checks and purge events; descriptions of cache-capable
  nodes gain the cache capability and named expected-demand fields. Non-cache analysis is unchanged.
- i18n catalogs include the new English/Arabic copy. Skill file fingerprints and generated viewer
  assets reflect documentation/schema changes and compiled i18n identifier shifts.
  Cache and Checks translations use the existing numeric lookup representation to avoid repeating
  English lookup strings in each locale. Every translation and all budgets are retained.
- A new `node/w3-cache.drawio` golden pins rules, cache-aside and a soft deploy-purge Drill.
  No simulation, trace, planning, layout, native or Mermaid output is intended to change.

The complete golden inventory is 354 changed files and one added file:

| Area                                                                    |   Files | Reason                                                                                                               |
| ----------------------------------------------------------------------- | ------: | -------------------------------------------------------------------------------------------------------------------- |
| `node/checks/*.json`                                                    |     146 | Four rule ids/About entries; findings and fix rechecks change only for `cache-stampede` and `corpus-w3-cache-aside`. |
| `node/checks-words/*.json`                                              |      66 | Rule-count summaries and the two caching fixtures' English/UI finding words.                                         |
| `node/evidence/*.json`                                                  |      46 | Check summaries, rule inventories and caching findings; simulation outcomes stay unchanged.                          |
| `node/agent/check/*.json`                                               |      66 | Rule counts, caching descriptors/fixes and explicit cache omissions.                                                 |
| `node/agent/describe/*.json`                                            |      25 | Cache capability, rule/Default estimates and nulls when analysis is unavailable.                                     |
| `node/agent/tools.json`                                                 |       1 | Checks and purge-event tool schemas/help.                                                                            |
| `node/i18n/catalogs.json`                                               |       1 | New copy and numeric catalog lookups.                                                                                |
| `node/skill/{public-schemas,files,corpus-hand-shaped-lines.files}.json` |       3 | Schema and source/reference fingerprints.                                                                            |
| `node/w3-cache.drawio`                                                  | 1 added | Rules, cache-aside and a soft deploy-purge Drill.                                                                    |

No browser, simulation, trace, planning, layout, native, Mermaid or existing draw.io golden changes.

## Validation and measurements

The production-build targeted gate passed 304 unit tests and five final browser tests, with no
failures or flakes. The wider related browser run passed all 19 tests. The broader affected unit
run had 567 passes, seven skips and one outdated rule-inventory assertion; the corrected file
passes the final focused gate. The full parity check passed 3,377 goldens unchanged against the
reviewed recordings and all 112 Linux browser cases.

Bundle split/reserve and full skill heavy tests passed (218 tests with the sizing regression).
The first w3-noop sweep passed 190 cases and hit a 5 s hang backstop in one blocking-call case
under concurrent verification; that exact case passed in isolation, without changing its test.
Initial locale budget failures were fixed with numeric lookups and concise Arabic copy. The
Arabic catalogs are 37,694 B core / 97,293 B total against the unchanged 38,000 / 97,500 B caps.

The fresh full-plugin ZIP is 827,982 B: 7,018 B below the 835,000 B cap and 874 B beyond its
required 6,144 B reserve. Both Claude plugin validations, regeneration, skill freshness, i18n,
build and size checks pass. Temporary reversions of Checks, agent upgrades, capacity replacement
and cache-aside origin selection each failed their targeted regression; the fixes were restored.

In one uncached same-run comparison, Black Friday Checks measured 846.8 → 1,941.0 ms. Scenario
sizing measured 807.8 → 492.3 ms with exactly one sizing call, four runs, 11,253 ticks and 25,485
messages on both sides. Timings are observations, not performance assertions; sizing work and
results are identical. The new cold-cache replay accounts for added Checks work.

No file under `src/sim` changed. Public-example screenshots are in
`C:/Users/latch/bin/codex-tasks/cdn-6-shots/`.

## Choices retained

Scaling is not a stampede fix, and a longer lifetime remains an explicit freshness decision.
Refused, incomplete or over-budget replays never certify a policy. A method-only rule is removed
instead of silently broadening its match. No budgets, reserves, checkpoint bounds or plugin
versions were raised.
