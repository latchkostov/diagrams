## Cache stampedes and one fetch per item

An expired hot item can now show its origin herd in Live. The lightning pill and Stampede chip appear only during a herd; coalescing shows one fetch with its waiting requests in a neutral tone. Cache rules expose **One fetch per item** behind **When an item expires**, off by default, with the hint that many CDNs already collapse requests this way. No toolbar controls were added.

The first miss starts one cache-owned real request at any sampling scale. Whole shopper dots park off-thread. Origin pools, retries, breakers and deadlines apply to the fetch; failure fails its waiters, while a shopper deadline leaves its waiter to complete as a late reply. Coalescing-only edits preserve active ownership and contents. Fetches already sent before enabling it drain normally.

The observed stampede callout offers only a same-seed proven **One fetch per item**, applied to the saved simulation or diagram in one undo step. Proof requires two further expiries of the same item, one fetch at most, origin backlog within its pre-herd backlog plus threads, and source p95 within 1.2× its pre-herd value. Missing, refused or over-budget evidence offers Events. A later expiry can supply a measurable baseline. Scaling and a longer TTL are excluded; stale responses and purges remain for PR 4. The new `itemFetches` expectation metric reports the largest current herd in real units.

## Example tuning and unchanged lessons

**A cache stampede** is a four-node Reliability example at scale 1. It keeps 400 requests/s, the 60 ms blocking Product API, 20 ms Catalog DB, physical network delays, 20,000 other products and all three approved chip thresholds. The launch item gets 80% of requests (320/s); its TTL is five seconds, and the origin has four threads. Those threads carry the measured warm product tail of about 27 requests/s, but expiry batches return before the prior queue has drained. TTL-only herds grow from about 65 to 640 fetches, backlog reaches thousands and p95 reaches about two seconds. Across seeds 1, 7, 17, 42 and 99 every TTL-only chip fails; one fetch per item keeps backlog below 10 and p95 below 300 ms, with every chip passing. These are workload changes, not relaxed assertions.

Black Friday adds **The doorbuster stampede** at scale 50, with 900 doorbuster views/s and the original ten-second TTL and origin capacity. Its story models about two analytics beacons per page view: 3,000 total requests/s, 30% doorbuster, 2% other product pages, 1% search and 67% analytics. This isolates the hot-item lesson from an unrelated broad catalogue overload. Herds reach roughly 250–450 fetches. The 18-second policy change makes later expiries fetch once; the authored 28-second fetch, end backlog and end p95 chips pass across five seeds. All three previous stories and their assertions remain intact.

## Verification and output parity

Focused regressions cover scaled ownership, leader failures, waiter deadlines and late replies, pools/retries, policy edits, the fill/local-work race, checkpoint replay, bounded checkpoint storage, C3 property checks, fix-ladder presets and browser Apply/Undo. UI regressions cover memoized waiter updates, neutral held herds, routed origins and unrelated-source isolation. The designer review approved the final interaction and readouts after those corrections.

Seven isolated reverted-module controls each fail their regression assertions. A checkpoint during a 30-dot herd charges at most 95,243 B at scales 1, 10 and 50, below the unchanged 130 KiB bound. The cache runtime is 2,944 B gzip in its own lazy chunk. Live's static download beyond the canvas is 127,071 B, leaving 7,929 B of its 135,000 B budget and 1,785 B before its existing reserve. The startup, reserve, skill and ZIP heavy checks pass. Locale/core limits also remain unchanged; the low headroom is recorded for a separate trim.

At seed 7, TTL-only sends 7,973 launch-item fetches (9,090 origin fetches overall) over 40 seconds; coalescing sends 8 launch-item fetches (1,092 overall). The launch item's peak falls from 640 concurrent fetches to 1. Across all five seeds, launch totals fall from 5,154–7,973 to 7–8. Other products retain their independent miss traffic.

## Golden inventory

The full update records 40 additions and 20 intentional changes. Every other existing golden is unchanged, including all previous simulation and trace records. Paths below are relative to `tests/parity/goldens/`.

| Existing golden                                           | Reason                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `node/agent/check/black-friday-commerce.json`             | Agent description/edit/check records include the fourth saved story.            |
| `node/agent/describe/black-friday-commerce.json`          | Agent description/edit/check records include the fourth saved story.            |
| `node/agent/edit/black-friday-commerce.json`              | Agent description/edit/check records include the fourth saved story.            |
| `node/agent/tools.json`                                   | Public contracts add coalesce and itemFetches.                                  |
| `node/evidence/black-friday-commerce.json`                | Saved-run evidence adds the fourth story; previous runs retain their outcomes.  |
| `node/exports/drawio-meta/black-friday-commerce.json`     | Native/draw.io/HTML metadata carries the added story and setup policy.          |
| `node/exports/drawio/black-friday-commerce.drawio`        | Native/draw.io/HTML metadata carries the added story and setup policy.          |
| `node/exports/html/black-friday-commerce.dark.json`       | Native/draw.io/HTML metadata carries the added story and setup policy.          |
| `node/exports/html/black-friday-commerce.light.json`      | Native/draw.io/HTML metadata carries the added story and setup policy.          |
| `node/exports/native/black-friday-commerce.diagram.json`  | Native/draw.io/HTML metadata carries the added story and setup policy.          |
| `node/i18n/catalogs.json`                                 | Thirteen English cache messages, ICU branches and locale fallback fingerprints. |
| `node/planning-p2/black-friday-commerce.json`             | Legacy conversion reports the added story and its setup policy losses.          |
| `node/planning/black-friday-commerce.json`                | Planning and automatic-scale records add the doorbuster story.                  |
| `node/skill/corpus-hand-shaped-lines.files.json`          | Generated format/spec contract records coalesce and itemFetches.                |
| `node/skill/corpus-hand-shaped-lines.public-schemas.json` | Frozen-client schema contracts expose the same new fields.                      |
| `node/skill/current-stencils.json`                        | The public example adds generic CDN, service and database usage.                |
| `node/skill/files.json`                                   | Generated format/spec/simulation references include the new policy and metric.  |
| `node/skill/public-schemas.json`                          | Diagram and operation schemas expose the policy and metric.                     |
| `node/skill/scripts/black-friday-commerce.json`           | Skill validation/share/export records include the fourth story.                 |
| `node/skill/validate/black-friday-commerce.txt`           | Skill validation/share/export records include the fourth story.                 |

Added goldens freeze the new example’s native/draw.io/Mermaid/HTML outputs, layout, checks, planning, agents, routes, three run states and traces; Black Friday gains only its doorbuster simulation and traces.

- `browser/layout/cache-stampede.json`
- `browser/render/cache-stampede.json`
- `node/agent/check/cache-stampede.json`
- `node/agent/describe/cache-stampede.json`
- `node/agent/edit/cache-stampede.json`
- `node/checks-words/cache-stampede.json`
- `node/checks/cache-stampede.json`
- `node/evidence/cache-stampede.json`
- `node/exports/drawio-meta/cache-stampede.json`
- `node/exports/drawio/cache-stampede.drawio`
- `node/exports/html/cache-stampede.dark.html`
- `node/exports/html/cache-stampede.dark.json`
- `node/exports/html/cache-stampede.light.html`
- `node/exports/html/cache-stampede.light.json`
- `node/exports/mermaid-plain/cache-stampede.mmd`
- `node/exports/mermaid-read/cache-stampede.json`
- `node/exports/mermaid/cache-stampede.mmd`
- `node/exports/native-meta/cache-stampede.json`
- `node/exports/native/cache-stampede.diagram.json`
- `node/layout/cache-stampede.json`
- `node/planning-p2/cache-stampede.json`
- `node/planning/cache-stampede.json`
- `node/routes/cache-stampede.json`
- `node/sim/black-friday-commerce/doorbuster-stampede.json`
- `node/sim/cache-stampede/free-play.json`
- `node/sim/cache-stampede/one-fetch.json`
- `node/sim/cache-stampede/ttl-only.json`
- `node/skill/scripts/cache-stampede.json`
- `node/skill/validate/cache-stampede.txt`
- `node/trace/black-friday-commerce/doorbuster-stampede.dead-letter.json`
- `node/trace/black-friday-commerce/doorbuster-stampede.json`
- `node/trace/black-friday-commerce/doorbuster-stampede.mmd`
- `node/trace/cache-stampede/free-play.json`
- `node/trace/cache-stampede/free-play.mmd`
- `node/trace/cache-stampede/one-fetch.dead-letter.json`
- `node/trace/cache-stampede/one-fetch.json`
- `node/trace/cache-stampede/one-fetch.mmd`
- `node/trace/cache-stampede/ttl-only.dead-letter.json`
- `node/trace/cache-stampede/ttl-only.json`
- `node/trace/cache-stampede/ttl-only.mmd`
