## Cache rules you can see and set

Cache-capable nodes now offer Add cache rules in Properties and their context menu. Ordered
rules expose matching, TTL presets, item counts and popularity. Expected hits are derived from
current traffic; large diagrams explain when analysis is unavailable. Row keyboard navigation,
reordering announcements, deletion, Undo and lazy-load recovery retain the Inspector's patterns.

Live shows a hit-ratio chip, a Cache section with observed hit and miss p95, Inputs derivations,
and cache decisions in traces, slow motion and the event log. Simulation expectations support
hitRatio, originOffload, originFetches and p95. The gallery has a caching feature tag.

## Black Friday preservation

The released A1 example is frozen as a compatibility fixture. The public example upgrades to W3
with non-blocking calls and zero reply time, physical network delays, four Edge CDN rules and
origins sized for warm traffic. At peak, Catalog runs at 62.30% warm / 480% cold utilization;
Search runs at 58.83% warm / 166.67% cold. Product pages derive 87.02% hits and search 64.70%.

Six outside calls gain explicit 2 s timeouts: risk, tax, warehouse, payment provider, email and
push. Fulfilment gains eight execution slots and a 2-core CPU limit to carry reply CPU work.
Checkout's route quota becomes 180 requests/s with a 90-request burst, preserving visible
shedding within the existing eight-second showcase observation. The CDN's origin call retries only
throttled replies, at most six attempts, with full jitter, 1 s exponential backoff capped at
4 s, a 50% retry budget and a 20 s deadline. This keeps excess 429s and makes the story's
existing retry claim true without losing requests. The earlier evidence difference was real:
waiting calls propagated the unretried 429s to their callers. Checks and evidence now agree.
The configured retry policy also gives Black Friday the existing resilience gallery tag.
All three authored expectation lists and existing large-showcase assertions remain unchanged.
The existing bounded retry-storm probe reports one call not checked on this large example;
its ceiling is unchanged, and no partial result is presented as a successful analysis.

## Intentional output parity

Black Friday's planning and upgrade records, agent describe/check/edit output, Checks words and
evidence, native/draw.io/HTML exports, route metadata, traces and four simulation outputs change
for the W3 upgrade, real caching, delays, origin sizing and preservation edits. Its drawing
coordinates and other existing diagrams' output stay unchanged. The frozen A1 fixture adds its
compatibility records. The newly observed partner-quota dead-letter trace adds a Mermaid output.

The changed contract goldens (paths below `tests/parity/goldens/`) are:

- `node/skill/public-schemas.json` and `node/skill/corpus-hand-shaped-lines.public-schemas.json`:
  the four metrics and explicit open predicates inside the otherwise strict cache-policy schema.
- `node/skill/files.json` and `node/skill/corpus-hand-shaped-lines.files.json`: refreshed schema
  spec hashes and the simulation metric reference.
- `node/agent/tools.json`: the new metrics and the cache-policy predicate clarification.
- `node/i18n/catalogs.json`: new cache readout messages, the translated cache-authoring action
  and the gallery feature label.

Generated skill assets and their authored simulation reference are refreshed by `pnpm regen`.
No golden is changed to excuse a failure; the full per-diagram inventory is in the PR description.
