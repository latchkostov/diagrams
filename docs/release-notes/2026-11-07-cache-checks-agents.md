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
  agent checks, fix rechecks and evidence reflect those findings. Black Friday remains clean.
- Agent tool schemas describe the cache checks and purge events; descriptions of cache-capable
  nodes gain the cache capability and named expected-demand fields. Non-cache analysis is unchanged.
- i18n catalogs include the new English/Arabic copy. Skill file fingerprints and generated viewer
  assets reflect documentation/schema changes and compiled i18n identifier shifts.
- A new `node/w3-cache.drawio` golden pins rules, cache-aside and a soft deploy-purge Drill.
  No simulation, trace, planning, layout, native or Mermaid output is intended to change.

## Validation

Targeted unit regressions cover both public caching examples, agent guards, purge authoring,
probe bounds/refusals, method removal, lifetime confirmation and draw.io round trips.
Final parity, browser, size and plugin validation results are recorded with the completed PR.
