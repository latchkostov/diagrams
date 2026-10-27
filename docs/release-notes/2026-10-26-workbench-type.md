## Canvas typography and meaning

Canvas second lines use Mona Sans at 11.5 px. Selected, narrated and flagged cards can grow to two lines, and their connection attachments are remeasured. Edge pills use measured proportional advances at 12 px / 96% width; they wrap or become a full-text hover dot instead of truncating. Async Edit connections keep full-opacity 2 px strokes.

Live rate text uses the existing Mona Sans width axis and tabular numbers in both rendering paths. Loss is the dark-red pill; processed counts are neutral; annotations have pale grounds and leading meaning glyphs. Large Overview main connections include narrated near edges and the current-rate top quartile.

## Export changes

The final canvas colour tokens and missing Round-6 control boundary token are included here, ahead of step 13, so all intentional output changes are recorded together. Restoring the control boundary changes the measured frame footprint and the affected fitted viewports. SVG and PNG adopt the canvas type, measured label placement, colours and stroke floor; Interactive HTML adopts those styles and badge meanings while retaining its existing weight-only Latin Mona Sans face. Embedding the full width-axis font would exceed the fixed skill ZIP cap (894,193 B). Removing editor-only frame code from the read-only viewer keeps the ZIP below the fixed cap without changing its behaviour.

The inventory below lists every changed golden. Simulation truth and checks-result goldens stay unchanged. The previously added retry-storm showcase description is now reflected in its data exports as described below.

## Validation

Targeted geometry, badge, decoration, canvas-font and token tests pass. The complete test run reported 13,933 passed and 15 failed; the eight affected files then passed all 58 tests after correcting the placement regression, stale fixtures and label expectations. Three lint-rule tests passed on rerun without a timeout change. The typography browser tests cover card growth and remeasurement, Edit stroke opacity, loss contrast and the main-thread font. Entry remains 111.0 KB gzip with 12.5 KB headroom; the viewer is 625.9 KB gzip.

## Golden inventory

### browser/html

Interactive HTML adopts Mona Sans canvas styles, measured pills, new canvas colours and revised initial Overview framing; the shell and payload remain unchanged. The three PNGs and drawn-geometry snapshots change accordingly.

`branch-to-datacentre.dark.drawn.json`, `branch-to-datacentre.dark.png`, `corpus-hand-shaped-lines.dark.drawn.json`, `corpus-hand-shaped-lines.dark.png`, `kafka-order-pipeline.dark.drawn.json`, `kafka-order-pipeline.dark.png`.

### browser/images

SVG text/styles, raster PNGs, image dimensions and their metadata change with Mona Sans subtitles, proportional pill sizing, canvas colours and full-opacity async strokes. The image route includes the earlier Workbench export framing changes.

`aks-app-config-key-vault.dark.png`, `aks-app-config-key-vault.dark.svg.json`, `aks-app-config-key-vault.dark.svg.txt`, `aks-app-config-key-vault.light.png`, `aks-app-config-key-vault.light.svg.json`, `aks-app-config-key-vault.light.svg.txt`, `branch-to-datacentre.dark.png`, `branch-to-datacentre.dark.svg.json`, `branch-to-datacentre.dark.svg.txt`, `branch-to-datacentre.light.png`, `branch-to-datacentre.light.svg.json`, `branch-to-datacentre.light.svg.txt`, `corpus-hand-shaped-lines.dark.png`, `corpus-hand-shaped-lines.dark.svg.json`, `corpus-hand-shaped-lines.dark.svg.txt`, `corpus-hand-shaped-lines.light.png`, `corpus-hand-shaped-lines.light.svg.json`, `corpus-hand-shaped-lines.light.svg.txt`, `kafka-order-pipeline.dark.png`, `kafka-order-pipeline.dark.svg.json`, `kafka-order-pipeline.dark.svg.txt`, `kafka-order-pipeline.light.png`, `kafka-order-pipeline.light.svg.json`, `kafka-order-pipeline.light.svg.txt`.

### browser/layout

Auto-layout and Tidy use the new measured label widths and expanded selected-card heights. Their routes, group bounds and fitted viewports change. Undo geometry is compared after restoring the original selection; undo selection remains independently asserted.

`aks-app-config-key-vault.json`, `api-route-table.json`, `autoscaling-basics.json`, `aws-serverless-orders.json`, `azure-service-bus-integration.json`, `black-friday-commerce.json`, `blocking-call.json`, `branch-to-datacentre.json`, `cdc-analytics.json`, `cell-based-bookings.json`, `cloud-run-timetable-api.json`, `contoso-dmz.json`, `corpus-hand-shaped-lines.json`, `cqrs-event-sourcing.json`, `delivery-dispatch.json`, `ev-charging-network.json`, `event-driven-data-platform.json`, `gcp-streaming-analytics.json`, `hybrid-enterprise-network.json`, `inline-rate-limit.json`, `kafka-order-pipeline.json`, `measured-order-capacity.json`, `nightly-batch-elt.json`, `notification-fanout.json`, `observability-pipeline.json`, `outbox-saga-checkout.json`, `partitions-vs-subscriptions.json`, `payments-ledger.json`, `rag-assistant.json`, `recommendations-feature-store.json`, `retry-storm.json`, `scale-on-busy-threads.json`, `serverless-burst-buffer.json`, `shared-api-quotas.json`, `shared-worker-pool.json`, `slow-payment-provider.json`, `vendor-edge-storefront.json`, `video-on-demand-pipeline.json`, `webhook-ingestion.json`, `where-the-time-goes.json`, `zone-outage-drill.json`.

### browser/render

Initial app frames use Overview or Focus by the 50% rule, with the rail/dock footprint and text floor. Label sizes, visible text and card dimensions follow measured Mona Sans; large Overview intentionally hides sub-floor text.

`aks-app-config-key-vault.json`, `api-route-table.json`, `autoscaling-basics.json`, `aws-serverless-orders.json`, `azure-service-bus-integration.json`, `black-friday-commerce.json`, `blocking-call.json`, `branch-to-datacentre.json`, `cdc-analytics.json`, `cell-based-bookings.json`, `cloud-run-timetable-api.json`, `contoso-dmz.json`, `corpus-hand-shaped-lines.json`, `cqrs-event-sourcing.json`, `delivery-dispatch.json`, `ev-charging-network.json`, `event-driven-data-platform.json`, `gcp-streaming-analytics.json`, `hybrid-enterprise-network.json`, `inline-rate-limit.json`, `kafka-order-pipeline.json`, `measured-order-capacity.json`, `nightly-batch-elt.json`, `notification-fanout.json`, `observability-pipeline.json`, `outbox-saga-checkout.json`, `partitions-vs-subscriptions.json`, `payments-ledger.json`, `rag-assistant.json`, `recommendations-feature-store.json`, `retry-storm.json`, `scale-on-busy-threads.json`, `serverless-burst-buffer.json`, `shared-api-quotas.json`, `shared-worker-pool.json`, `slow-payment-provider.json`, `vendor-edge-storefront.json`, `video-on-demand-pipeline.json`, `webhook-ingestion.json`, `where-the-time-goes.json`, `zone-outage-drill.json`.

### browser/selection

The hand-shaped-line snapshot retains the selected edge and its handles. Its fitted viewport, proportional label rectangles and label-aware handle positions change with the canvas metrics.

`corpus-hand-shaped-lines.json`.

### node/agent/describe

The retry-storm agent description includes the earlier showcase instruction to select Payments and compare Throughput and Queue in This run during the first ten seconds.

`retry-storm.json`.

### node/agent/edit

The retry-storm edit-tool result retains the updated showcase description. Diagram operations and simulation behaviour are unchanged.

`retry-storm.json`.

### node/exports/drawio

The retry-storm draw.io XML carries the updated showcase description.

`retry-storm.drawio`.

### node/exports/drawio-meta

The retry-storm draw.io metadata includes the longer showcase description, changing its byte count and digest.

`retry-storm.json`.

### node/exports/html

Both retry-storm HTML data fixtures carry the longer showcase description; their file lengths and hashes change.

`retry-storm.dark.json`, `retry-storm.light.json`.

### node/exports/mermaid

The retry-storm Mermaid comment carries the updated showcase description.

`retry-storm.mmd`.

### node/exports/mermaid-read

Mermaid import performs deterministic layout: its node and boundary coordinates change with proportional label reserves. Parsed semantic content is unchanged.

`aks-app-config-key-vault.json`, `api-route-table.json`, `aws-serverless-orders.json`, `azure-service-bus-integration.json`, `black-friday-commerce.json`, `cdc-analytics.json`, `cell-based-bookings.json`, `corpus-annotation-course.json`, `corpus-checks-checkout-shortcuts.json`, `corpus-checks-payments-ledger.json`, `corpus-checks-shared-ids.json`, `corpus-cycle.json`, `corpus-edge-kinds.json`, `corpus-edge-relations.json`, `corpus-edge-sides.json`, `cqrs-event-sourcing.json`, `delivery-dispatch.json`, `ev-charging-network.json`, `event-driven-data-platform.json`, `gcp-streaming-analytics.json`, `hybrid-enterprise-network.json`, `kafka-order-pipeline.json`, `nightly-batch-elt.json`, `notification-fanout.json`, `observability-pipeline.json`, `outbox-saga-checkout.json`, `payments-ledger.json`, `rag-assistant.json`, `recommendations-feature-store.json`, `video-on-demand-pipeline.json`, `webhook-ingestion.json`.

### node/exports/native

The retry-storm native JSON carries the updated showcase description. Its nodes, connections and simulations remain unchanged.

`retry-storm.diagram.json`.

### node/i18n

The catalogs include the prior Workbench strings and all 37 translations, plus locale-formatted narration indices. Message/fallback counts and hashes change; no translations are dropped.

`catalogs.json`.

### node/layout

Deterministic layout and Tidy coordinates change because label reserves use measured proportional advances instead of a fixed character width.

`aks-app-config-key-vault.json`, `api-route-table.json`, `aws-serverless-orders.json`, `azure-service-bus-integration.json`, `black-friday-commerce.json`, `branch-to-datacentre.json`, `cdc-analytics.json`, `cell-based-bookings.json`, `corpus-annotation-course.json`, `corpus-checks-checkout-shortcuts.json`, `corpus-checks-payments-ledger.json`, `corpus-checks-shared-ids.json`, `corpus-cycle.json`, `corpus-edge-kinds.json`, `corpus-edge-relations.json`, `corpus-edge-sides.json`, `cqrs-event-sourcing.json`, `delivery-dispatch.json`, `ev-charging-network.json`, `event-driven-data-platform.json`, `gcp-streaming-analytics.json`, `hybrid-enterprise-network.json`, `kafka-order-pipeline.json`, `nightly-batch-elt.json`, `notification-fanout.json`, `observability-pipeline.json`, `outbox-saga-checkout.json`, `payments-ledger.json`, `rag-assistant.json`, `recommendations-feature-store.json`, `serverless-burst-buffer.json`, `shared-worker-pool.json`, `video-on-demand-pipeline.json`, `webhook-ingestion.json`.

### node/routes

Route and label snapshots adopt measured Mona Sans pill sizes, new line height and wrap-or-dot fallback. Changed label obstacles can shift routes and preserve their no-overlap contract.

`aks-app-config-key-vault.json`, `api-route-table.json`, `aws-serverless-orders.json`, `azure-service-bus-integration.json`, `black-friday-commerce.json`, `branch-to-datacentre.json`, `cdc-analytics.json`, `cell-based-bookings.json`, `contoso-dmz.json`, `corpus-annotation-course.json`, `corpus-back-edges.json`, `corpus-checks-checkout-shortcuts.json`, `corpus-checks-payments-ledger.json`, `corpus-checks-shared-ids.json`, `corpus-cycle.json`, `corpus-edge-kinds.json`, `corpus-edge-relations.json`, `corpus-edge-sides.json`, `corpus-export-contract.json`, `corpus-hand-shaped-lines.json`, `corpus-obstacle-course.json`, `corpus-planning-p2-kafka.json`, `corpus-planning-p2-kinesis.json`, `corpus-planning-p2-queue.json`, `corpus-planning-p2-sns.json`, `corpus-relationships.json`, `corpus-text-fields.json`, `cqrs-event-sourcing.json`, `delivery-dispatch.json`, `ev-charging-network.json`, `event-driven-data-platform.json`, `gcp-streaming-analytics.json`, `hybrid-enterprise-network.json`, `kafka-order-pipeline.json`, `measured-order-capacity.json`, `nightly-batch-elt.json`, `notification-fanout.json`, `observability-pipeline.json`, `outbox-saga-checkout.json`, `partitions-vs-subscriptions.json`, `payments-ledger.json`, `rag-assistant.json`, `recommendations-feature-store.json`, `serverless-burst-buffer.json`, `shared-api-quotas.json`, `shared-worker-pool.json`, `video-on-demand-pipeline.json`, `webhook-ingestion.json`, `zone-outage-drill.json`.

### node/skill/scripts

The regenerated skill renderer shares the new label measurements and resulting layout coordinates. These goldens pin the same diagrams rendered by that code.

`aks-app-config-key-vault.json`, `api-route-table.json`, `aws-serverless-orders.json`, `azure-service-bus-integration.json`, `black-friday-commerce.json`, `cdc-analytics.json`, `cell-based-bookings.json`, `cqrs-event-sourcing.json`, `delivery-dispatch.json`, `ev-charging-network.json`, `event-driven-data-platform.json`, `gcp-streaming-analytics.json`, `hybrid-enterprise-network.json`, `kafka-order-pipeline.json`, `nightly-batch-elt.json`, `notification-fanout.json`, `outbox-saga-checkout.json`, `payments-ledger.json`, `rag-assistant.json`, `recommendations-feature-store.json`, `retry-storm.json`, `video-on-demand-pipeline.json`, `webhook-ingestion.json`.
