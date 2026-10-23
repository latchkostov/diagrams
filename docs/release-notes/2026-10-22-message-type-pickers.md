## Message types you can see and pick

Links now show Carries, Only pass and Send as in Simulation. Select existing message types as chips, add a new type with feedback when nothing sends it, and rename through a picker. Sources have Sends; processors have editable incoming/outgoing rules. Edge hover lists carried types without adding canvas pills or bar buttons. All edits use the existing file format.

## Message-loop Check

A shared, bounded static fixed point follows source types, processor emits maps, link renames and filters. Inspector, Checks and agent descriptions share it. The warning names the looping type and processor. A verified single filter preserves non-loop traffic and applies in one undo step; a rename option appears only when a second propagation confirms it stops the loop. Intrinsic retries and broker redelivery are excluded. No automatic edit is offered when a safe single change cannot be verified.

The existing live trouble watcher has aggregate counters, not per-type amplification counters, so this release leaves loop diagnosis to Checks. It adds no runtime watcher.

## Showcase

Webhook ingestion returns a WebhookApplied callback to its receiver. The receiver's outgoing filters pass WebhookEvent only, so callbacks stop there. A public-example test observes callback delivery within ten simulated seconds. The gallery tags this and existing typed-filter examples with Message types.

## Golden changes

461 existing goldens change intentionally; none are added. Every path is listed below, relative to tests/parity/goldens.

Agent descriptions add arrivingTypes per node, carriedTypes per edge and a completeness flag. Shared Checks and agent reports add message-loop to the rules run (including summary counts); corpus-w1-loop gains the new warning, which remains after its separate sync-cycle fix. Evidence replay results retain their previous behavior except the edited webhook example. Agent schema/tool lists add the rule, its description and new report capabilities. Message catalog parity includes the new English strings and fallback messages. Skill validation reports the showcase's extra edge.

Every webhook golden follows its new typed callback, outgoing filters and description: exports/skill scripts encode the new connection and properties; planning and playback include receiver work for callbacks; traces include the return hop; layout/routing/render goldens include the return edge and its port/label placement. No other simulation, trace, route, layout or export golden changes. The webhook section of src/canvas/geometry/**snapshots**/examples.test.ts.snap also changes for the added return edge; its overlap and full-label assertions pass unchanged.

## Webhook example golden inventory

<details>
<summary>31 changed files</summary>

- `browser/layout/webhook-ingestion.json`
- `browser/render/webhook-ingestion.json`
- `node/agent/check/webhook-ingestion.json`
- `node/agent/describe/webhook-ingestion.json`
- `node/agent/edit/webhook-ingestion.json`
- `node/checks-words/webhook-ingestion.json`
- `node/checks/webhook-ingestion.json`
- `node/evidence/webhook-ingestion.json`
- `node/exports/drawio-meta/webhook-ingestion.json`
- `node/exports/drawio/webhook-ingestion.drawio`
- `node/exports/html/webhook-ingestion.dark.json`
- `node/exports/html/webhook-ingestion.light.json`
- `node/exports/mermaid-plain/webhook-ingestion.mmd`
- `node/exports/mermaid-read/webhook-ingestion.json`
- `node/exports/mermaid/webhook-ingestion.mmd`
- `node/exports/native/webhook-ingestion.diagram.json`
- `node/planning-p2/webhook-ingestion.json`
- `node/planning/webhook-ingestion.json`
- `node/routes/webhook-ingestion.json`
- `node/sim/webhook-ingestion/bulk-sync.json`
- `node/sim/webhook-ingestion/free-play.json`
- `node/sim/webhook-ingestion/outage-replay.json`
- `node/skill/scripts/webhook-ingestion.json`
- `node/trace/webhook-ingestion/bulk-sync.json`
- `node/trace/webhook-ingestion/bulk-sync.mmd`
- `node/trace/webhook-ingestion/free-play.json`
- `node/trace/webhook-ingestion/free-play.mmd`
- `node/trace/webhook-ingestion/outage-replay.dead-letter.json`
- `node/trace/webhook-ingestion/outage-replay.dead-letter.mmd`
- `node/trace/webhook-ingestion/outage-replay.json`
- `node/trace/webhook-ingestion/outage-replay.mmd`

</details>

## Agent checks and schemas golden inventory

<details>
<summary>63 changed files</summary>

- `node/agent/check/aks-app-config-key-vault.json`
- `node/agent/check/autoscaling-basics.json`
- `node/agent/check/aws-serverless-orders.json`
- `node/agent/check/azure-service-bus-integration.json`
- `node/agent/check/black-friday-commerce.json`
- `node/agent/check/branch-to-datacentre.json`
- `node/agent/check/cdc-analytics.json`
- `node/agent/check/cell-based-bookings.json`
- `node/agent/check/contoso-dmz.json`
- `node/agent/check/corpus-a1-burst-scale-up.json`
- `node/agent/check/corpus-a1-downscale-stabilization.json`
- `node/agent/check/corpus-a1-idle-partitions.json`
- `node/agent/check/corpus-a1-image-workers.json`
- `node/agent/check/corpus-a1-startup-backlog.json`
- `node/agent/check/corpus-a2-idle.json`
- `node/agent/check/corpus-a3-aca-http.json`
- `node/agent/check/corpus-a3-app-service.json`
- `node/agent/check/corpus-a3-cloud-run.json`
- `node/agent/check/corpus-annotation-course.json`
- `node/agent/check/corpus-back-edges.json`
- `node/agent/check/corpus-check-sync-chain-3.json`
- `node/agent/check/corpus-custom-colours.json`
- `node/agent/check/corpus-cycle.json`
- `node/agent/check/corpus-export-contract.json`
- `node/agent/check/corpus-fan-edges.json`
- `node/agent/check/corpus-fan-out.json`
- `node/agent/check/corpus-header-overflow.json`
- `node/agent/check/corpus-layers.json`
- `node/agent/check/corpus-p3-api-gateway.json`
- `node/agent/check/corpus-p3-lambda.json`
- `node/agent/check/corpus-p3-openai.json`
- `node/agent/check/corpus-p3-stripe.json`
- `node/agent/check/corpus-r1-callers.json`
- `node/agent/check/corpus-r1-mix-table.json`
- `node/agent/check/corpus-r1-quotas.json`
- `node/agent/check/corpus-scenario-sim-fan-out.json`
- `node/agent/check/corpus-scenario-sim-gateway-round-robin.json`
- `node/agent/check/corpus-text-fields.json`
- `node/agent/check/corpus-w1-loop.json`
- `node/agent/check/corpus-w2-blocking-backoff.json`
- `node/agent/check/corpus-w2-budget.json`
- `node/agent/check/corpus-w2-exponential.json`
- `node/agent/check/corpus-w2-fixed.json`
- `node/agent/check/corpus-w2-jitter.json`
- `node/agent/check/corpus-w2-pool-deadline.json`
- `node/agent/check/corpus-w2-sampling.json`
- `node/agent/check/cqrs-event-sourcing.json`
- `node/agent/check/delivery-dispatch.json`
- `node/agent/check/ev-charging-network.json`
- `node/agent/check/event-driven-data-platform.json`
- `node/agent/check/gcp-streaming-analytics.json`
- `node/agent/check/hybrid-enterprise-network.json`
- `node/agent/check/kafka-order-pipeline.json`
- `node/agent/check/nightly-batch-elt.json`
- `node/agent/check/notification-fanout.json`
- `node/agent/check/observability-pipeline.json`
- `node/agent/check/payments-ledger.json`
- `node/agent/check/rag-assistant.json`
- `node/agent/check/recommendations-feature-store.json`
- `node/agent/check/video-on-demand-pipeline.json`
- `node/agent/check/where-the-time-goes.json`
- `node/agent/check/zone-outage-drill.json`
- `node/agent/tools.json`

</details>

## Agent descriptions golden inventory

<details>
<summary>130 changed files</summary>

- `node/agent/describe/aks-app-config-key-vault.json`
- `node/agent/describe/api-route-table.json`
- `node/agent/describe/autoscaling-basics.json`
- `node/agent/describe/aws-serverless-orders.json`
- `node/agent/describe/azure-service-bus-integration.json`
- `node/agent/describe/black-friday-commerce.json`
- `node/agent/describe/blocking-call.json`
- `node/agent/describe/branch-to-datacentre.json`
- `node/agent/describe/cdc-analytics.json`
- `node/agent/describe/cell-based-bookings.json`
- `node/agent/describe/cloud-run-timetable-api.json`
- `node/agent/describe/contoso-dmz.json`
- `node/agent/describe/corpus-a1-burst-scale-up.json`
- `node/agent/describe/corpus-a1-downscale-stabilization.json`
- `node/agent/describe/corpus-a1-idle-partitions.json`
- `node/agent/describe/corpus-a1-image-workers.json`
- `node/agent/describe/corpus-a1-max-reached.json`
- `node/agent/describe/corpus-a1-startup-backlog.json`
- `node/agent/describe/corpus-a2-activation.json`
- `node/agent/describe/corpus-a2-cooldown.json`
- `node/agent/describe/corpus-a2-idle.json`
- `node/agent/describe/corpus-a2-render-workers.json`
- `node/agent/describe/corpus-a3-aca-event.json`
- `node/agent/describe/corpus-a3-aca-http.json`
- `node/agent/describe/corpus-a3-app-service.json`
- `node/agent/describe/corpus-a3-cloud-run.json`
- `node/agent/describe/corpus-a3-ecs-alb.json`
- `node/agent/describe/corpus-a3-ecs-step.json`
- `node/agent/describe/corpus-a3-planner-max.json`
- `node/agent/describe/corpus-a3-planner-partitions.json`
- `node/agent/describe/corpus-a3-planner-quota.json`
- `node/agent/describe/corpus-a3-planner-target.json`
- `node/agent/describe/corpus-annotation-course.json`
- `node/agent/describe/corpus-back-edges.json`
- `node/agent/describe/corpus-check-load-100.json`
- `node/agent/describe/corpus-check-load-79.json`
- `node/agent/describe/corpus-check-load-80.json`
- `node/agent/describe/corpus-check-load-99.json`
- `node/agent/describe/corpus-check-sync-chain-3.json`
- `node/agent/describe/corpus-check-sync-chain-4.json`
- `node/agent/describe/corpus-checks-checkout-shortcuts.json`
- `node/agent/describe/corpus-checks-payments-ledger.json`
- `node/agent/describe/corpus-custom-colours.json`
- `node/agent/describe/corpus-cycle.json`
- `node/agent/describe/corpus-edge-kinds.json`
- `node/agent/describe/corpus-edge-relations.json`
- `node/agent/describe/corpus-edge-sides.json`
- `node/agent/describe/corpus-export-contract.json`
- `node/agent/describe/corpus-fan-edges.json`
- `node/agent/describe/corpus-fan-out.json`
- `node/agent/describe/corpus-groups.json`
- `node/agent/describe/corpus-header-overflow.json`
- `node/agent/describe/corpus-layers.json`
- `node/agent/describe/corpus-obstacle-course.json`
- `node/agent/describe/corpus-odd-nodes.json`
- `node/agent/describe/corpus-p3-api-gateway.json`
- `node/agent/describe/corpus-p3-external-api.json`
- `node/agent/describe/corpus-p3-lambda.json`
- `node/agent/describe/corpus-p3-openai-shared.json`
- `node/agent/describe/corpus-p3-openai.json`
- `node/agent/describe/corpus-p3-shared-quota.json`
- `node/agent/describe/corpus-p3-stripe.json`
- `node/agent/describe/corpus-planning-connections.json`
- `node/agent/describe/corpus-planning-many-groups.json`
- `node/agent/describe/corpus-planning-no-reader.json`
- `node/agent/describe/corpus-planning-orders.json`
- `node/agent/describe/corpus-planning-outage.json`
- `node/agent/describe/corpus-planning-p2-kafka.json`
- `node/agent/describe/corpus-planning-p2-kinesis.json`
- `node/agent/describe/corpus-planning-p2-queue.json`
- `node/agent/describe/corpus-planning-p2-sns.json`
- `node/agent/describe/corpus-r1-callers.json`
- `node/agent/describe/corpus-r1-mix-table.json`
- `node/agent/describe/corpus-r1-overlap.json`
- `node/agent/describe/corpus-r1-quotas.json`
- `node/agent/describe/corpus-relationships.json`
- `node/agent/describe/corpus-scenario-sim-competing-consumers.json`
- `node/agent/describe/corpus-scenario-sim-dlq.json`
- `node/agent/describe/corpus-scenario-sim-fan-out.json`
- `node/agent/describe/corpus-scenario-sim-gateway-round-robin.json`
- `node/agent/describe/corpus-scenario-sim-slow-consumer.json`
- `node/agent/describe/corpus-scenario-sim-traffic-storm.json`
- `node/agent/describe/corpus-sim-review-diagnostic.json`
- `node/agent/describe/corpus-sim-review.json`
- `node/agent/describe/corpus-text-fields.json`
- `node/agent/describe/corpus-w1-blocking.json`
- `node/agent/describe/corpus-w1-busy-threads.json`
- `node/agent/describe/corpus-w1-deadline.json`
- `node/agent/describe/corpus-w1-gateway.json`
- `node/agent/describe/corpus-w1-held-drain.json`
- `node/agent/describe/corpus-w1-inflight-cap.json`
- `node/agent/describe/corpus-w1-join-failure.json`
- `node/agent/describe/corpus-w1-loop.json`
- `node/agent/describe/corpus-w1-nonblocking.json`
- `node/agent/describe/corpus-w1-pool.json`
- `node/agent/describe/corpus-w1-sampling.json`
- `node/agent/describe/corpus-w2-blocking-backoff.json`
- `node/agent/describe/corpus-w2-broker-dlq.json`
- `node/agent/describe/corpus-w2-budget.json`
- `node/agent/describe/corpus-w2-exponential.json`
- `node/agent/describe/corpus-w2-fixed.json`
- `node/agent/describe/corpus-w2-jitter.json`
- `node/agent/describe/corpus-w2-pool-deadline.json`
- `node/agent/describe/corpus-w2-sampling.json`
- `node/agent/describe/cqrs-event-sourcing.json`
- `node/agent/describe/delivery-dispatch.json`
- `node/agent/describe/ev-charging-network.json`
- `node/agent/describe/event-driven-data-platform.json`
- `node/agent/describe/gcp-streaming-analytics.json`
- `node/agent/describe/hybrid-enterprise-network.json`
- `node/agent/describe/kafka-order-pipeline.json`
- `node/agent/describe/measured-order-capacity.json`
- `node/agent/describe/nightly-batch-elt.json`
- `node/agent/describe/notification-fanout.json`
- `node/agent/describe/observability-pipeline.json`
- `node/agent/describe/outbox-saga-checkout.json`
- `node/agent/describe/partitions-vs-subscriptions.json`
- `node/agent/describe/payments-ledger.json`
- `node/agent/describe/rag-assistant.json`
- `node/agent/describe/recommendations-feature-store.json`
- `node/agent/describe/retry-storm.json`
- `node/agent/describe/scale-on-busy-threads.json`
- `node/agent/describe/serverless-burst-buffer.json`
- `node/agent/describe/shared-api-quotas.json`
- `node/agent/describe/shared-worker-pool.json`
- `node/agent/describe/slow-payment-provider.json`
- `node/agent/describe/video-on-demand-pipeline.json`
- `node/agent/describe/w2-slow-payment-provider.json`
- `node/agent/describe/where-the-time-goes.json`
- `node/agent/describe/zone-outage-drill.json`

</details>

## Checks golden inventory

<details>
<summary>195 changed files</summary>

- `node/checks-words/aks-app-config-key-vault.json`
- `node/checks-words/autoscaling-basics.json`
- `node/checks-words/aws-serverless-orders.json`
- `node/checks-words/azure-service-bus-integration.json`
- `node/checks-words/black-friday-commerce.json`
- `node/checks-words/branch-to-datacentre.json`
- `node/checks-words/cdc-analytics.json`
- `node/checks-words/cell-based-bookings.json`
- `node/checks-words/contoso-dmz.json`
- `node/checks-words/corpus-a1-burst-scale-up.json`
- `node/checks-words/corpus-a1-downscale-stabilization.json`
- `node/checks-words/corpus-a1-idle-partitions.json`
- `node/checks-words/corpus-a1-image-workers.json`
- `node/checks-words/corpus-a1-startup-backlog.json`
- `node/checks-words/corpus-a2-idle.json`
- `node/checks-words/corpus-a3-aca-http.json`
- `node/checks-words/corpus-a3-app-service.json`
- `node/checks-words/corpus-a3-cloud-run.json`
- `node/checks-words/corpus-annotation-course.json`
- `node/checks-words/corpus-back-edges.json`
- `node/checks-words/corpus-check-sync-chain-3.json`
- `node/checks-words/corpus-custom-colours.json`
- `node/checks-words/corpus-cycle.json`
- `node/checks-words/corpus-export-contract.json`
- `node/checks-words/corpus-fan-edges.json`
- `node/checks-words/corpus-fan-out.json`
- `node/checks-words/corpus-header-overflow.json`
- `node/checks-words/corpus-layers.json`
- `node/checks-words/corpus-p3-api-gateway.json`
- `node/checks-words/corpus-p3-lambda.json`
- `node/checks-words/corpus-p3-openai.json`
- `node/checks-words/corpus-p3-stripe.json`
- `node/checks-words/corpus-r1-callers.json`
- `node/checks-words/corpus-r1-mix-table.json`
- `node/checks-words/corpus-r1-quotas.json`
- `node/checks-words/corpus-scenario-sim-fan-out.json`
- `node/checks-words/corpus-scenario-sim-gateway-round-robin.json`
- `node/checks-words/corpus-text-fields.json`
- `node/checks-words/corpus-w1-loop.json`
- `node/checks-words/corpus-w2-blocking-backoff.json`
- `node/checks-words/corpus-w2-budget.json`
- `node/checks-words/corpus-w2-exponential.json`
- `node/checks-words/corpus-w2-fixed.json`
- `node/checks-words/corpus-w2-jitter.json`
- `node/checks-words/corpus-w2-pool-deadline.json`
- `node/checks-words/corpus-w2-sampling.json`
- `node/checks-words/cqrs-event-sourcing.json`
- `node/checks-words/delivery-dispatch.json`
- `node/checks-words/ev-charging-network.json`
- `node/checks-words/event-driven-data-platform.json`
- `node/checks-words/gcp-streaming-analytics.json`
- `node/checks-words/hybrid-enterprise-network.json`
- `node/checks-words/kafka-order-pipeline.json`
- `node/checks-words/nightly-batch-elt.json`
- `node/checks-words/notification-fanout.json`
- `node/checks-words/observability-pipeline.json`
- `node/checks-words/payments-ledger.json`
- `node/checks-words/rag-assistant.json`
- `node/checks-words/recommendations-feature-store.json`
- `node/checks-words/video-on-demand-pipeline.json`
- `node/checks-words/where-the-time-goes.json`
- `node/checks-words/zone-outage-drill.json`
- `node/checks/aks-app-config-key-vault.json`
- `node/checks/api-route-table.json`
- `node/checks/autoscaling-basics.json`
- `node/checks/aws-serverless-orders.json`
- `node/checks/azure-service-bus-integration.json`
- `node/checks/black-friday-commerce.json`
- `node/checks/blocking-call.json`
- `node/checks/branch-to-datacentre.json`
- `node/checks/cdc-analytics.json`
- `node/checks/cell-based-bookings.json`
- `node/checks/cloud-run-timetable-api.json`
- `node/checks/contoso-dmz.json`
- `node/checks/corpus-a1-burst-scale-up.json`
- `node/checks/corpus-a1-downscale-stabilization.json`
- `node/checks/corpus-a1-idle-partitions.json`
- `node/checks/corpus-a1-image-workers.json`
- `node/checks/corpus-a1-max-reached.json`
- `node/checks/corpus-a1-startup-backlog.json`
- `node/checks/corpus-a2-activation.json`
- `node/checks/corpus-a2-cooldown.json`
- `node/checks/corpus-a2-idle.json`
- `node/checks/corpus-a2-render-workers.json`
- `node/checks/corpus-a3-aca-event.json`
- `node/checks/corpus-a3-aca-http.json`
- `node/checks/corpus-a3-app-service.json`
- `node/checks/corpus-a3-cloud-run.json`
- `node/checks/corpus-a3-ecs-alb.json`
- `node/checks/corpus-a3-ecs-step.json`
- `node/checks/corpus-a3-planner-max.json`
- `node/checks/corpus-a3-planner-partitions.json`
- `node/checks/corpus-a3-planner-quota.json`
- `node/checks/corpus-a3-planner-target.json`
- `node/checks/corpus-annotation-course.json`
- `node/checks/corpus-back-edges.json`
- `node/checks/corpus-check-load-100.json`
- `node/checks/corpus-check-load-79.json`
- `node/checks/corpus-check-load-80.json`
- `node/checks/corpus-check-load-99.json`
- `node/checks/corpus-check-sync-chain-3.json`
- `node/checks/corpus-check-sync-chain-4.json`
- `node/checks/corpus-checks-checkout-shortcuts.json`
- `node/checks/corpus-checks-payments-ledger.json`
- `node/checks/corpus-checks-shared-ids.json`
- `node/checks/corpus-custom-colours.json`
- `node/checks/corpus-cycle.json`
- `node/checks/corpus-edge-kinds.json`
- `node/checks/corpus-edge-relations.json`
- `node/checks/corpus-edge-sides.json`
- `node/checks/corpus-export-contract.json`
- `node/checks/corpus-fan-edges.json`
- `node/checks/corpus-fan-out.json`
- `node/checks/corpus-groups.json`
- `node/checks/corpus-header-overflow.json`
- `node/checks/corpus-layers.json`
- `node/checks/corpus-obstacle-course.json`
- `node/checks/corpus-odd-nodes.json`
- `node/checks/corpus-p3-api-gateway.json`
- `node/checks/corpus-p3-external-api.json`
- `node/checks/corpus-p3-lambda.json`
- `node/checks/corpus-p3-openai-shared.json`
- `node/checks/corpus-p3-openai.json`
- `node/checks/corpus-p3-shared-quota.json`
- `node/checks/corpus-p3-stripe.json`
- `node/checks/corpus-planning-analysis-limit.json`
- `node/checks/corpus-planning-connections.json`
- `node/checks/corpus-planning-many-groups.json`
- `node/checks/corpus-planning-no-reader.json`
- `node/checks/corpus-planning-orders.json`
- `node/checks/corpus-planning-outage.json`
- `node/checks/corpus-planning-p2-kafka.json`
- `node/checks/corpus-planning-p2-kinesis.json`
- `node/checks/corpus-planning-p2-queue.json`
- `node/checks/corpus-planning-p2-sns.json`
- `node/checks/corpus-r1-callers.json`
- `node/checks/corpus-r1-mix-table.json`
- `node/checks/corpus-r1-overlap.json`
- `node/checks/corpus-r1-quotas.json`
- `node/checks/corpus-relationships.json`
- `node/checks/corpus-scenario-sim-competing-consumers.json`
- `node/checks/corpus-scenario-sim-dlq.json`
- `node/checks/corpus-scenario-sim-fan-out.json`
- `node/checks/corpus-scenario-sim-gateway-round-robin.json`
- `node/checks/corpus-scenario-sim-slow-consumer.json`
- `node/checks/corpus-scenario-sim-traffic-storm.json`
- `node/checks/corpus-sim-review-diagnostic.json`
- `node/checks/corpus-sim-review.json`
- `node/checks/corpus-text-fields.json`
- `node/checks/corpus-w1-blocking.json`
- `node/checks/corpus-w1-busy-threads.json`
- `node/checks/corpus-w1-deadline.json`
- `node/checks/corpus-w1-gateway.json`
- `node/checks/corpus-w1-held-drain.json`
- `node/checks/corpus-w1-inflight-cap.json`
- `node/checks/corpus-w1-join-failure.json`
- `node/checks/corpus-w1-loop.json`
- `node/checks/corpus-w1-nonblocking.json`
- `node/checks/corpus-w1-pool.json`
- `node/checks/corpus-w1-sampling.json`
- `node/checks/corpus-w2-blocking-backoff.json`
- `node/checks/corpus-w2-broker-dlq.json`
- `node/checks/corpus-w2-budget.json`
- `node/checks/corpus-w2-exponential.json`
- `node/checks/corpus-w2-fixed.json`
- `node/checks/corpus-w2-jitter.json`
- `node/checks/corpus-w2-pool-deadline.json`
- `node/checks/corpus-w2-sampling.json`
- `node/checks/cqrs-event-sourcing.json`
- `node/checks/delivery-dispatch.json`
- `node/checks/ev-charging-network.json`
- `node/checks/event-driven-data-platform.json`
- `node/checks/gcp-streaming-analytics.json`
- `node/checks/hybrid-enterprise-network.json`
- `node/checks/kafka-order-pipeline.json`
- `node/checks/measured-order-capacity.json`
- `node/checks/nightly-batch-elt.json`
- `node/checks/notification-fanout.json`
- `node/checks/observability-pipeline.json`
- `node/checks/outbox-saga-checkout.json`
- `node/checks/partitions-vs-subscriptions.json`
- `node/checks/payments-ledger.json`
- `node/checks/rag-assistant.json`
- `node/checks/recommendations-feature-store.json`
- `node/checks/retry-storm.json`
- `node/checks/rules.json`
- `node/checks/scale-on-busy-threads.json`
- `node/checks/serverless-burst-buffer.json`
- `node/checks/shared-api-quotas.json`
- `node/checks/shared-worker-pool.json`
- `node/checks/slow-payment-provider.json`
- `node/checks/video-on-demand-pipeline.json`
- `node/checks/w2-slow-payment-provider.json`
- `node/checks/where-the-time-goes.json`
- `node/checks/zone-outage-drill.json`

</details>

## Simulation evidence summaries golden inventory

<details>
<summary>39 changed files</summary>

- `node/evidence/aks-app-config-key-vault.json`
- `node/evidence/autoscaling-basics.json`
- `node/evidence/aws-serverless-orders.json`
- `node/evidence/azure-service-bus-integration.json`
- `node/evidence/black-friday-commerce.json`
- `node/evidence/branch-to-datacentre.json`
- `node/evidence/cdc-analytics.json`
- `node/evidence/cell-based-bookings.json`
- `node/evidence/contoso-dmz.json`
- `node/evidence/corpus-a1-burst-scale-up.json`
- `node/evidence/corpus-a1-downscale-stabilization.json`
- `node/evidence/corpus-a1-idle-partitions.json`
- `node/evidence/corpus-a1-image-workers.json`
- `node/evidence/corpus-a1-startup-backlog.json`
- `node/evidence/corpus-a2-idle.json`
- `node/evidence/corpus-a3-aca-http.json`
- `node/evidence/corpus-a3-app-service.json`
- `node/evidence/corpus-a3-cloud-run.json`
- `node/evidence/corpus-export-contract.json`
- `node/evidence/corpus-p3-stripe.json`
- `node/evidence/corpus-r1-callers.json`
- `node/evidence/corpus-r1-mix-table.json`
- `node/evidence/corpus-r1-quotas.json`
- `node/evidence/corpus-w1-loop.json`
- `node/evidence/cqrs-event-sourcing.json`
- `node/evidence/delivery-dispatch.json`
- `node/evidence/ev-charging-network.json`
- `node/evidence/event-driven-data-platform.json`
- `node/evidence/gcp-streaming-analytics.json`
- `node/evidence/hybrid-enterprise-network.json`
- `node/evidence/kafka-order-pipeline.json`
- `node/evidence/nightly-batch-elt.json`
- `node/evidence/notification-fanout.json`
- `node/evidence/observability-pipeline.json`
- `node/evidence/payments-ledger.json`
- `node/evidence/rag-assistant.json`
- `node/evidence/recommendations-feature-store.json`
- `node/evidence/video-on-demand-pipeline.json`
- `node/evidence/where-the-time-goes.json`

</details>

## Message catalogs golden inventory

<details>
<summary>1 changed files</summary>

- `node/i18n/catalogs.json`

</details>

## Skill contracts golden inventory

<details>
<summary>2 changed files</summary>

- `node/skill/public-schemas.json`
- `node/skill/validate.txt`

</details>
