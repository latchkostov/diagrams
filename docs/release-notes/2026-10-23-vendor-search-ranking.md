## Vendor stencil search and Cloud gallery inventory (2026-10-23, #251)

Search keeps established stencils ahead of newly added vendor variants at equal relevance, even when
category menus enumerate the variants first. Exact names and product aliases rank above name prefixes;
compatibility and role keywords remain searchable without borrowing exact-alias priority. The keyboard-only Kafka
construction therefore keeps Redis Stream and Redis Cache ahead of Redpanda for `red`.

The pinned gallery inventory now includes `vendor-edge-storefront` first in **Cloud**, matching its
existing registry position. Its CDN, WAF, object storage and managed identity services fit that theme.
Its `vendorStencils` feature tag is unchanged; no featured example or start-card choice changes.

## Verification and parity

The released search expectations were recorded using origin/master `d614cf7a` and cover the e2e
stencil inputs and common queries, including redis, postgres, kafka, nginx, s3 and lambda. Tests exercise
both English and displayed search with catalog order and vendor-first menu order. Temporarily restoring
the original search files from `88d24798` makes both new regression tests fail. The existing
flow-building test is unchanged.

Only `node/agent/find-stencils.json` changes intentionally:

- For `Kafka topic`, the five-result limit now retains RabbitMQ Exchange rather than Redpanda after
  compatibility keywords lose exact-alias priority. The first four results are unchanged.
- For `queue`, SQS and Amazon MQ precede ActiveMQ; all seven results remain present.

Every simulation and rendering golden remains byte-identical. Redundant index work is trimmed, and gallery-only descriptions load with the stencil library:
`canvasFirstView` is 382,614 B (382 B below the original 382,996 B), under the unchanged 383,000 B budget.

## Rebase onto circuit breakers

Sync rebased onto `dd389319` and regenerated five conflicted records from combined sources:

- `node/exports/html/retry-storm.dark.json` and `retry-storm.light.json`: the newer retry-storm ladder's
  export metadata together with the vendor stencil catalog.
- `node/i18n/catalogs.json`: both features' English messages and translation fallback fingerprints.
- `node/skill/public-schemas.json`: the breaker contracts and the vendor stencil inventory.
- `node/skill/files.json`: the combined generated specification's hash and byte count, refreshed again
  after replaying the existing vendor capability correction.

No golden contents were hand-merged. Existing simulation goldens are byte-identical to the original
branch. A build regression keeps the gallery-only descriptions outside the first canvas download;
reintroducing an eager re-export deliberately fails it. Startup chunk names and all budgets are unchanged.
