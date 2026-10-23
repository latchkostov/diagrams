## Popular vendor stencils

Adds 58 searchable vendor stencils across the existing categories: Network 17,
Messaging 2, Data 16, Observability 3, Security & config 6, Clients & external 10,
and Compute 4. The [research](../research/vendor-coverage-2026-10.md) records current
coverage, dated public evidence, selection limits and candidates for later.

Fastly, Akamai, CloudFront, Bunny and Google Cloud CDN join the existing edge
stencils. WAF, DNS, API gateways, brokers, database subtypes, object storage,
observability, identity, payments, notifications, feature flags, CI/CD, serverless
compute and model APIs gain focused additions. They retain their category
representative's simulation, planning and request/dependency behavior. No CDN
caching, vendor quotas or performance claims are introduced.

Brand names stay unchanged; descriptions reuse existing translated category
wording. The new Vendor stencils example-filter label uses the standard English
fallback until translated. The invented Independent edge storefront demonstrates
Fastly, Cloudflare WAF, Fastly Compute, R2, Square, LaunchDarkly and Cognito, with
receipt and payment deliveries within eight simulated seconds.

## Artwork and download size

All 58 use neutral Lucide glyphs under ISC, recorded individually in
[ICONS.md](../ICONS.md). The telemetry glyph is the only new SVG. No vendor logo
is added without a redistribution grant. Production icons retain their bytes and
individual loading, sharing a content-addressed directory to reduce the URL
manifest. Artwork remains outside startup; entry, startup, canvas and live bundle
budgets are unchanged. Generated skill assets remain below the 835,000-byte cap.

## Output parity

Catalogue lists, agent discovery/schema metadata and generated skill references
expand with the new IDs, aliases and broker metadata. The stencil-to-icon list
embedded in existing Interactive HTML export goldens expands too; the paired JSON
goldens consequently change the file fingerprint, while diagram payloads and SVG
bytes stay unchanged. The language-catalogue golden records the new example-filter
message. New goldens cover the standalone storefront example. Existing simulation,
planning, layout, native-file and image outputs must remain unchanged.

The complete path inventory below records every intended change.

## Deliberate limits

Keeps the nine panel categories and existing search/details controls. Defers the
research document's longer tail, new simulation semantics, unverified vendor
limits and unlicensed brand artwork. Parent descriptions are shared rather than
duplicated into untranslated vendor copy.

## Verification

The production Chromium stencil spec passed all 18 tests with zero retries or
flakes. The vendor/locale/example tests passed; a final focused run covering the
corrected inventories and every timed-out unit case passed 92 tests. The original
complete unit run had nine failures: three new-example inventory omissions were
fixed, and six hit existing five-second backstops under load. Two of those also
reproduced on clean master; details are in the
[backlog fragment](../backlog/2026-10-23-simulation-test-backstops.md). The complete
unit suite was not repeated.

Parity recording passed 1,843 Node cases and 101 Linux browser cases. The image
recheck passed all six cases and 53 goldens unchanged. An overlapping Node parity
summary lost its shared scratch ledger and incorrectly reported stale files;
all 1,843 comparisons themselves passed. Final skill fingerprints were refreshed
separately. Bundle gates, production build, entry/viewer/Forge size gates and i18n
validation passed; the final skill ZIP measured 824,642 bytes. No thresholds were raised.

## Complete golden inventory

200 existing parity goldens change; 27 are added for the public storefront. Paths below are relative to `tests/parity/goldens/`. No existing simulation, planning, native diagram, geometry or image golden changes.

## HTML stencil-to-icon lists and paired fingerprints (156)

Existing diagram payloads and SVG bytes stay identical. Only the complete embedded stencil-to-icon list and its resulting file fingerprint change.

```text
browser/html/branch-to-datacentre.dark.html
browser/html/branch-to-datacentre.default.html
browser/html/kafka-order-pipeline.dark.html
browser/html/kafka-order-pipeline.default.html
node/exports/html/aks-app-config-key-vault.dark.html
node/exports/html/aks-app-config-key-vault.dark.json
node/exports/html/aks-app-config-key-vault.light.html
node/exports/html/aks-app-config-key-vault.light.json
node/exports/html/api-route-table.dark.html
node/exports/html/api-route-table.dark.json
node/exports/html/api-route-table.light.html
node/exports/html/api-route-table.light.json
node/exports/html/autoscaling-basics.dark.html
node/exports/html/autoscaling-basics.dark.json
node/exports/html/autoscaling-basics.light.html
node/exports/html/autoscaling-basics.light.json
node/exports/html/aws-serverless-orders.dark.html
node/exports/html/aws-serverless-orders.dark.json
node/exports/html/aws-serverless-orders.light.html
node/exports/html/aws-serverless-orders.light.json
node/exports/html/azure-service-bus-integration.dark.html
node/exports/html/azure-service-bus-integration.dark.json
node/exports/html/azure-service-bus-integration.light.html
node/exports/html/azure-service-bus-integration.light.json
node/exports/html/black-friday-commerce.dark.html
node/exports/html/black-friday-commerce.dark.json
node/exports/html/black-friday-commerce.light.html
node/exports/html/black-friday-commerce.light.json
node/exports/html/blocking-call.dark.html
node/exports/html/blocking-call.dark.json
node/exports/html/blocking-call.light.html
node/exports/html/blocking-call.light.json
node/exports/html/branch-to-datacentre.dark.html
node/exports/html/branch-to-datacentre.dark.json
node/exports/html/branch-to-datacentre.light.html
node/exports/html/branch-to-datacentre.light.json
node/exports/html/cdc-analytics.dark.html
node/exports/html/cdc-analytics.dark.json
node/exports/html/cdc-analytics.light.html
node/exports/html/cdc-analytics.light.json
node/exports/html/cell-based-bookings.dark.html
node/exports/html/cell-based-bookings.dark.json
node/exports/html/cell-based-bookings.light.html
node/exports/html/cell-based-bookings.light.json
node/exports/html/cloud-run-timetable-api.dark.html
node/exports/html/cloud-run-timetable-api.dark.json
node/exports/html/cloud-run-timetable-api.light.html
node/exports/html/cloud-run-timetable-api.light.json
node/exports/html/contoso-dmz.dark.html
node/exports/html/contoso-dmz.dark.json
node/exports/html/contoso-dmz.light.html
node/exports/html/contoso-dmz.light.json
node/exports/html/cqrs-event-sourcing.dark.html
node/exports/html/cqrs-event-sourcing.dark.json
node/exports/html/cqrs-event-sourcing.light.html
node/exports/html/cqrs-event-sourcing.light.json
node/exports/html/delivery-dispatch.dark.html
node/exports/html/delivery-dispatch.dark.json
node/exports/html/delivery-dispatch.light.html
node/exports/html/delivery-dispatch.light.json
node/exports/html/ev-charging-network.dark.html
node/exports/html/ev-charging-network.dark.json
node/exports/html/ev-charging-network.light.html
node/exports/html/ev-charging-network.light.json
node/exports/html/event-driven-data-platform.dark.html
node/exports/html/event-driven-data-platform.dark.json
node/exports/html/event-driven-data-platform.light.html
node/exports/html/event-driven-data-platform.light.json
node/exports/html/gcp-streaming-analytics.dark.html
node/exports/html/gcp-streaming-analytics.dark.json
node/exports/html/gcp-streaming-analytics.light.html
node/exports/html/gcp-streaming-analytics.light.json
node/exports/html/hybrid-enterprise-network.dark.html
node/exports/html/hybrid-enterprise-network.dark.json
node/exports/html/hybrid-enterprise-network.light.html
node/exports/html/hybrid-enterprise-network.light.json
node/exports/html/kafka-order-pipeline.dark.html
node/exports/html/kafka-order-pipeline.dark.json
node/exports/html/kafka-order-pipeline.light.html
node/exports/html/kafka-order-pipeline.light.json
node/exports/html/measured-order-capacity.dark.html
node/exports/html/measured-order-capacity.dark.json
node/exports/html/measured-order-capacity.light.html
node/exports/html/measured-order-capacity.light.json
node/exports/html/nightly-batch-elt.dark.html
node/exports/html/nightly-batch-elt.dark.json
node/exports/html/nightly-batch-elt.light.html
node/exports/html/nightly-batch-elt.light.json
node/exports/html/notification-fanout.dark.html
node/exports/html/notification-fanout.dark.json
node/exports/html/notification-fanout.light.html
node/exports/html/notification-fanout.light.json
node/exports/html/observability-pipeline.dark.html
node/exports/html/observability-pipeline.dark.json
node/exports/html/observability-pipeline.light.html
node/exports/html/observability-pipeline.light.json
node/exports/html/outbox-saga-checkout.dark.html
node/exports/html/outbox-saga-checkout.dark.json
node/exports/html/outbox-saga-checkout.light.html
node/exports/html/outbox-saga-checkout.light.json
node/exports/html/partitions-vs-subscriptions.dark.html
node/exports/html/partitions-vs-subscriptions.dark.json
node/exports/html/partitions-vs-subscriptions.light.html
node/exports/html/partitions-vs-subscriptions.light.json
node/exports/html/payments-ledger.dark.html
node/exports/html/payments-ledger.dark.json
node/exports/html/payments-ledger.light.html
node/exports/html/payments-ledger.light.json
node/exports/html/rag-assistant.dark.html
node/exports/html/rag-assistant.dark.json
node/exports/html/rag-assistant.light.html
node/exports/html/rag-assistant.light.json
node/exports/html/recommendations-feature-store.dark.html
node/exports/html/recommendations-feature-store.dark.json
node/exports/html/recommendations-feature-store.light.html
node/exports/html/recommendations-feature-store.light.json
node/exports/html/retry-storm.dark.html
node/exports/html/retry-storm.dark.json
node/exports/html/retry-storm.light.html
node/exports/html/retry-storm.light.json
node/exports/html/scale-on-busy-threads.dark.html
node/exports/html/scale-on-busy-threads.dark.json
node/exports/html/scale-on-busy-threads.light.html
node/exports/html/scale-on-busy-threads.light.json
node/exports/html/serverless-burst-buffer.dark.html
node/exports/html/serverless-burst-buffer.dark.json
node/exports/html/serverless-burst-buffer.light.html
node/exports/html/serverless-burst-buffer.light.json
node/exports/html/shared-api-quotas.dark.html
node/exports/html/shared-api-quotas.dark.json
node/exports/html/shared-api-quotas.light.html
node/exports/html/shared-api-quotas.light.json
node/exports/html/shared-worker-pool.dark.html
node/exports/html/shared-worker-pool.dark.json
node/exports/html/shared-worker-pool.light.html
node/exports/html/shared-worker-pool.light.json
node/exports/html/slow-payment-provider.dark.html
node/exports/html/slow-payment-provider.dark.json
node/exports/html/slow-payment-provider.light.html
node/exports/html/slow-payment-provider.light.json
node/exports/html/video-on-demand-pipeline.dark.html
node/exports/html/video-on-demand-pipeline.dark.json
node/exports/html/video-on-demand-pipeline.light.html
node/exports/html/video-on-demand-pipeline.light.json
node/exports/html/webhook-ingestion.dark.html
node/exports/html/webhook-ingestion.dark.json
node/exports/html/webhook-ingestion.light.html
node/exports/html/webhook-ingestion.light.json
node/exports/html/where-the-time-goes.dark.html
node/exports/html/where-the-time-goes.dark.json
node/exports/html/where-the-time-goes.light.html
node/exports/html/where-the-time-goes.light.json
node/exports/html/zone-outage-drill.dark.html
node/exports/html/zone-outage-drill.dark.json
node/exports/html/zone-outage-drill.light.html
node/exports/html/zone-outage-drill.light.json
```

## Agent stencil discovery alternatives (39)

Search results and edit-operation stencil alternatives gain the new catalogue matches; chosen diagram operations and simulation behaviour stay the same.

```text
node/agent/edit/aks-app-config-key-vault.json
node/agent/edit/api-route-table.json
node/agent/edit/autoscaling-basics.json
node/agent/edit/aws-serverless-orders.json
node/agent/edit/azure-service-bus-integration.json
node/agent/edit/black-friday-commerce.json
node/agent/edit/blocking-call.json
node/agent/edit/branch-to-datacentre.json
node/agent/edit/cdc-analytics.json
node/agent/edit/cell-based-bookings.json
node/agent/edit/cloud-run-timetable-api.json
node/agent/edit/contoso-dmz.json
node/agent/edit/cqrs-event-sourcing.json
node/agent/edit/delivery-dispatch.json
node/agent/edit/ev-charging-network.json
node/agent/edit/event-driven-data-platform.json
node/agent/edit/gcp-streaming-analytics.json
node/agent/edit/hybrid-enterprise-network.json
node/agent/edit/kafka-order-pipeline.json
node/agent/edit/measured-order-capacity.json
node/agent/edit/nightly-batch-elt.json
node/agent/edit/notification-fanout.json
node/agent/edit/observability-pipeline.json
node/agent/edit/outbox-saga-checkout.json
node/agent/edit/partitions-vs-subscriptions.json
node/agent/edit/payments-ledger.json
node/agent/edit/rag-assistant.json
node/agent/edit/recommendations-feature-store.json
node/agent/edit/retry-storm.json
node/agent/edit/scale-on-busy-threads.json
node/agent/edit/serverless-burst-buffer.json
node/agent/edit/shared-api-quotas.json
node/agent/edit/shared-worker-pool.json
node/agent/edit/slow-payment-provider.json
node/agent/edit/video-on-demand-pipeline.json
node/agent/edit/webhook-ingestion.json
node/agent/edit/where-the-time-goes.json
node/agent/edit/zone-outage-drill.json
node/agent/find-stencils.json
```

## Managed stencil defaults (1)

Lists the new API/serverless variants using their existing parents’ measured/unknown defaults; no provider quotas are invented.

```text
node/admission/presets.json
```

## Generated skill, schema and stencil references (3)

Fingerprints track expanded stencils, aliases, inherited broker metadata, the public showcase reference and refreshed offline viewer.

```text
node/skill/current-stencils.json
node/skill/files.json
node/skill/public-schemas.json
```

## Localized message inventory (1)

Records the new Vendor stencils feature-label key and normal English fallback in locales without that message.

```text
node/i18n/catalogs.json
```

## New storefront outputs (27)

New records cover the standalone example’s validation, files, drawing, routes, free play, trace, planning and agent reports. They do not replace existing examples.

```text
browser/layout/vendor-edge-storefront.json
browser/render/vendor-edge-storefront.json
node/agent/check/vendor-edge-storefront.json
node/agent/describe/vendor-edge-storefront.json
node/agent/edit/vendor-edge-storefront.json
node/checks-words/vendor-edge-storefront.json
node/checks/vendor-edge-storefront.json
node/exports/drawio-meta/vendor-edge-storefront.json
node/exports/drawio/vendor-edge-storefront.drawio
node/exports/html/vendor-edge-storefront.dark.html
node/exports/html/vendor-edge-storefront.dark.json
node/exports/html/vendor-edge-storefront.light.html
node/exports/html/vendor-edge-storefront.light.json
node/exports/mermaid-plain/vendor-edge-storefront.mmd
node/exports/mermaid-read/vendor-edge-storefront.json
node/exports/mermaid/vendor-edge-storefront.mmd
node/exports/native-meta/vendor-edge-storefront.json
node/exports/native/vendor-edge-storefront.diagram.json
node/layout/vendor-edge-storefront.json
node/planning-p2/vendor-edge-storefront.json
node/planning/vendor-edge-storefront.json
node/routes/vendor-edge-storefront.json
node/sim/vendor-edge-storefront/free-play.json
node/skill/scripts/vendor-edge-storefront.json
node/skill/validate/vendor-edge-storefront.txt
node/trace/vendor-edge-storefront/free-play.json
node/trace/vendor-edge-storefront/free-play.mmd
```

The separate Vitest geometry snapshot adds only `vendor-edge-storefront.json` in `src/canvas/geometry/__snapshots__/examples.test.ts.snap`; every existing snapshot stays identical.
