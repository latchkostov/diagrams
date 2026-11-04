## Stale serving and cache purges (PR 4)

The cache policy can serve stale copies while one background fetch refreshes an
item. Purge faults support hard or soft invalidation, one rule or every rule, and
deploy wording. A Cold cache drill uses the same instant fault. The fix ladder
tries One fetch per item before Serve stale while refreshing. A miss queued
across a purge still fills when its fetch returns. Don’t store rules do not
create cold-cache evidence for a soft purge. Origin trouble names the observed
purge and elapsed simulation time without offering Clear faults for an instant
action.

The small cache-stampede example now has five comparisons. The owner corrected
the design's §6.2 hard-purge row: refilling 20,000 other products takes minutes,
and the four-thread Product API stays far behind through the unchanged run.
Backlog and shopper p95 fail across all five seeds; soft purge passes every chip.
The narration and run-end lesson explain that result without promising recovery.

The item-fetch metric has no selector and measures the maximum over all tracked
items. Its chip now says “Most fetches in flight for one item”, retaining the
same threshold. Simulations 1–2 retain their asserted outcomes. The two existing simulation goldens change only this label; their numerical
results and asserted bands are unchanged.

Parity adds four simulations and their twelve trace records. Existing example
records reflect the new saved stories and corrected copy; shared schema, skill
and translation records reflect the new contracts and words. All 112 browser
parity checks pass without a changed browser golden. The full file inventory
and reason for each changed golden follow below.

Black Friday adds a steady doorbuster peak: 90% doorbuster, 8% other products
and 2% search at 1,450 cacheable requests/s. Hard deploy discards the copies; a
later soft deploy retains them with a one-minute stale window on every storing
rule. Its unchanged chips pass across five seeds. This read-only story fixes
the initial checkout and fulfilment fleets; no traffic reaches those pipelines,
so it adds no scenario-sizing playback.

All 37 non-English catalogs include the new messages. Arabic and Hebrew isolate
interpolated values. Stale controls stay inside the expiry fold; purge actions
stay in the contextual Fault menu. Rule selectors preserve unrestricted IDs,
including names that resemble the All rules and default entries.

## Bounds and measurements

Statistical bands share one fluid revalidation remainder per rule: their
expected rates add linearly and use the same origin/fill clock. This preserves
the aggregate real-unit refresh work without a per-band allocation at the
256-rule limit. It changes fractional dispatch timing only in the new stale
mode; tracked items still own at most one background fetch. A fully populated
256-rule / 4,096-item stale checkpoint adds 72,654 bytes against the unchanged
130 KiB allowance. Restoring per-band credits makes that regression fail at
429,630 bytes.

Across seeds 1, 7, 17, 42 and 99, hard-purge end backlogs are 807, 825, 798,
815 and 807, with p95 2,050 ms. Soft purge peaks at 11–18 queued requests,
drains by the end and keeps p95 at 258.04 ms. Black Friday hard-deploy queues
peak at 350–700 real requests and p95 at 1.67–3.50 seconds; after soft deploy
the peak queue is 55–57 and end shopper p95 is 52.8 ms. Every Black Friday chip
passes.

Before feature edits, unmemoized Black Friday planScaling measured 965.6 ms
cold and 723.7, 672.8 and 678.5 ms warm. The final same-process before/after
comparison measured before 986.2, 699.1, 582.6 and 614.7 ms; after 565.6, 556.0,
547.8 and 560.5 ms. Timings are descriptive, not absolute test budgets. Both
sides retain four runs, 11,248 ticks and 25,218 messages; the new read-only
story adds no autoscaler sizing playback.

Measured production cache runtime: 4,288 bytes gzip (5 KiB cap). Live adds
128,196 bytes gzip beyond the canvas, leaving 6,804 bytes against 135,000 and
660 bytes beyond the fixed 6,144-byte reserve. No budget or reserve was raised.
The narrow remaining reserve has a separate trim follow-up.

## Parity inventory

Paths below are relative to `tests/parity/goldens/`. There are 35 changed and
16 added records, with no removed records or changed browser goldens.

| Golden                                                          | Intentional change                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `node/agent/check/black-friday-commerce.json`                   | Saved-simulation counts and the intentional hard-purge expectation failures. |
| `node/agent/check/cache-stampede.json`                          | Saved-simulation counts and the intentional hard-purge expectation failures. |
| `node/agent/describe/black-friday-commerce.json`                | New saved stories, setup policies and corrected example/chip wording.        |
| `node/agent/describe/cache-stampede.json`                       | New saved stories, setup policies and corrected example/chip wording.        |
| `node/agent/edit/black-friday-commerce.json`                    | New saved stories, setup policies and corrected example/chip wording.        |
| `node/agent/edit/cache-stampede.json`                           | New saved stories, setup policies and corrected example/chip wording.        |
| `node/agent/tools.json`                                         | Purge Fault/Cold cache drill and stale-window schema contracts.              |
| `node/evidence/black-friday-commerce.json`                      | Five saved comparisons and their intentional passing/failing expectations.   |
| `node/evidence/cache-stampede.json`                             | Five saved comparisons and their intentional passing/failing expectations.   |
| `node/exports/drawio-meta/black-friday-commerce.json`           | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/drawio-meta/cache-stampede.json`                  | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/drawio/black-friday-commerce.drawio`              | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/drawio/cache-stampede.drawio`                     | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/html/black-friday-commerce.dark.json`             | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/html/black-friday-commerce.light.json`            | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/html/cache-stampede.dark.json`                    | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/html/cache-stampede.light.json`                   | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/mermaid/cache-stampede.mmd`                       | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/native/black-friday-commerce.diagram.json`        | Public example copy, saved stories and their round-trip metadata.            |
| `node/exports/native/cache-stampede.diagram.json`               | Public example copy, saved stories and their round-trip metadata.            |
| `node/i18n/catalogs.json`                                       | 25 new messages, translations and correct core/surface ownership.            |
| `node/planning-p2/black-friday-commerce.json`                   | New saved-run compatibility records; existing P2 results remain unchanged.   |
| `node/planning-p2/cache-stampede.json`                          | New saved-run compatibility records; existing P2 results remain unchanged.   |
| `node/planning/black-friday-commerce.json`                      | New saved-run planning, expected cache rates and setup policies.             |
| `node/planning/cache-stampede.json`                             | New saved-run planning, expected cache rates and setup policies.             |
| `node/sim/black-friday-commerce/edge-deploy.json`               | New story simulation snapshot.                                               |
| `node/sim/cache-stampede/hard-purge.json`                       | New story simulation snapshot.                                               |
| `node/sim/cache-stampede/one-fetch.json`                        | Item-fetch label only; every numerical result is unchanged.                  |
| `node/sim/cache-stampede/serve-stale.json`                      | New story simulation snapshot.                                               |
| `node/sim/cache-stampede/soft-purge.json`                       | New story simulation snapshot.                                               |
| `node/sim/cache-stampede/ttl-only.json`                         | Item-fetch label only; every numerical result is unchanged.                  |
| `node/skill/corpus-hand-shaped-lines.files.json`                | Generated skill asset/schema lengths and hashes.                             |
| `node/skill/corpus-hand-shaped-lines.public-schemas.json`       | Generated Fault, drill and cache-policy schema contract hashes.              |
| `node/skill/files.json`                                         | Generated skill asset/schema lengths and hashes.                             |
| `node/skill/public-schemas.json`                                | Generated Fault, drill and cache-policy schema contract hashes.              |
| `node/skill/scripts/black-friday-commerce.json`                 | Public example payload carries the added stories and corrected wording.      |
| `node/skill/scripts/cache-stampede.json`                        | Public example payload carries the added stories and corrected wording.      |
| `node/skill/validate/black-friday-commerce.txt`                 | Saved-simulation count and instant-purge validation output.                  |
| `node/skill/validate/cache-stampede.txt`                        | Saved-simulation count and instant-purge validation output.                  |
| `node/trace/black-friday-commerce/edge-deploy.dead-letter.json` | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/black-friday-commerce/edge-deploy.json`             | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/black-friday-commerce/edge-deploy.mmd`              | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/cache-stampede/hard-purge.dead-letter.json`         | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/cache-stampede/hard-purge.json`                     | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/cache-stampede/hard-purge.mmd`                      | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/cache-stampede/serve-stale.dead-letter.json`        | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/cache-stampede/serve-stale.json`                    | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/cache-stampede/serve-stale.mmd`                     | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/cache-stampede/soft-purge.dead-letter.json`         | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/cache-stampede/soft-purge.json`                     | New story trace, Mermaid journey or dead-letter result.                      |
| `node/trace/cache-stampede/soft-purge.mmd`                      | New story trace, Mermaid journey or dead-letter result.                      |
