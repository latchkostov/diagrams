## Branded web and mobile clients

Clients now includes React, Vue, Angular, Svelte, Next.js, Nuxt, React Native, Flutter, SwiftUI (iOS) and
Jetpack Compose (Android). Search by framework name or common aliases. They send traffic with exactly
the same settings and behaviour as Web Browser or Mobile App. The existing AWS serverless orders
example uses a Next.js storefront and is tagged Branded clients.

Vue and SwiftUI use neutral browser/mobile glyphs because their artwork terms restrict redistribution;
the other marks, sources and licences are recorded in [ICONS.md](../ICONS.md).

The appearance settings now import node dimensions and labels without importing renderer components or icon
URLs. File-format catalogue and validation metadata share one preloaded model chunk, preserving schema
initialization order. No bundle budget was raised. The measured gzip sizes are 107,799 B entry,
171,072 B startup, 382,118 B canvas first view and 134,421 B Live; the skill ZIP remains below 835,000 B.

## Golden changes

167 existing goldens change intentionally; none is added or removed. No simulation, capacity,
plain Mermaid, geometry or non-storefront rendered-image golden changes. Paths below are relative to
`tests/parity/goldens/`; this is the complete list.

## Exported viewer catalogue (4)

The four browser HTML wrappers embed the same expanded stencil-to-icon registry. Their diagram payloads and rendered diagrams are unchanged.

```text
browser/html/branch-to-datacentre.dark.html
browser/html/branch-to-datacentre.default.html
browser/html/kafka-order-pipeline.dark.html
browser/html/kafka-order-pipeline.default.html
```

## Storefront agent reports (2)

The existing storefront now reports client.nextjs and its brand metadata. Requests and simulation outcomes are unchanged.

```text
node/agent/describe/aws-serverless-orders.json
node/agent/edit/aws-serverless-orders.json
```

## Storefront file exports (4)

The existing storefront persists client.nextjs, its accent and its icon where supported. Mermaid keeps the same client stadium shape; its metadata changes. Native and draw.io files preserve the new stencil.

```text
node/exports/drawio-meta/aws-serverless-orders.json
node/exports/drawio/aws-serverless-orders.drawio
node/exports/mermaid/aws-serverless-orders.mmd
node/exports/native/aws-serverless-orders.diagram.json
```

## HTML catalogue and storefront exports (152)

Every HTML template embeds the complete stencil-to-icon registry: ten new entries change the template and its file fingerprint. For AWS serverless orders only, the payload also changes from Web Browser to Next.js, including the Next.js icon fingerprint. Other diagram payloads and their simulations are unchanged.

```text
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

## Translated catalogue (1)

Three English messages and their translations in all 37 languages add shared web/mobile framework descriptions and the Branded clients gallery feature. Brand names remain literal ICU values.

```text
node/i18n/catalogs.json
```

## Skill reference and schemas (4)

The generated stencil reference and schema fingerprints include the ten new ids. The skill script output for the existing AWS example carries its Next.js storefront.

```text
node/skill/current-stencils.json
node/skill/files.json
node/skill/public-schemas.json
node/skill/scripts/aws-serverless-orders.json
```
