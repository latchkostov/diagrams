## Resilience checks and agent parity (2026-10-24)

Checks now diagnose jitter/backoff, retry budgets, unsafe repeated side effects, retry layers,
missing circuit breakers and queues that can outlive their callers. A bounded Slow dependency probe
checks up to three retried calls at configured rates. It offers one cumulative policy only when a
same-seed replay proves recovery, naming the changes and successful-work evidence. No speculative
probe alternatives or scaling are offered. Static idempotency alternatives remain undoable.

Health uses the shared current ten-second window. Skipped/refused probes are counted in
`notChecked.retryStorm`; omitted findings and incomplete probes never read as clean. Names and emitted
characters are bounded. Deep chains retain their actual layer count and mark capped amplification as a lower bound. Static checks share one compiled topology and one capacity analysis.

`describe_diagram` exposes Request resilience and processor queue policies, including steady/worst
amplification and wait ceilings. `check_diagram` carries the same descriptors, edits and replay proof.
The expectation picker now completes the five metrics with `shortCircuited` and `shed`; real-unit
coverage includes scales 1, 2 and 10. Skill guidance uses p3-w2 for new diagrams and documents retries,
breakers, shedding and tools. The existing public retry-storm and payment-provider lessons cover this
feature; no simulation input or outcome was changed.

Two approved-design phrases were made more accurate: short backoff can need repair even with jitter,
so the finding says “need jittered backoff”; “throttled responses” includes shed 503 as well as 429.
New UI copy has translation keys; untranslated catalogs fall back to English. Option completion
toasts now name the selected translated option.

## Intended golden inventory

Exactly 326 existing goldens change; none is added or removed. No simulation, trace, planning,
rendering, layout, import or export outcome changes. The initial complete parity check found only
these categories, including the Linux browser tier. The update was restricted to checks, agent,
skill and i18n parity producers (Checks also owns its evidence and words producers).

- 136 `node/checks` records: seven registered rule IDs in run metadata and rule catalog; W2 findings,
  their preset edits and post-fix checks; incomplete probe counts where budgets refuse a replay.
- 64 `node/checks-words` records: matching English finding/fix/evidence words and check counts.
- 46 `node/evidence` records: the same static findings and check counts embedded in saved-run
  evidence reports. Their simulation loss counts are unchanged.
- 75 `node/agent` records: 64 check replies, 10 W2 descriptions and the tools contract. Check replies
  include resilience descriptors/edits/proof and the larger registered-rule count. W2 descriptions
  add executed policy/amplification/queue fields. Tools gain rule choices and the two missing metrics.
- Four `node/skill` records: current/frozen public-schema fingerprints gain the two expectation
  fields; current/frozen file fingerprints gain the generated metric spec; the current skill file
  fingerprint also records the authored default-model and resilience guidance.
- One `node/i18n/catalogs.json` record: 50 English keys, area fingerprints and fallback counts.

The complete path inventory follows, grouped by producer. Each path has the reason for its group above.

## node/agent (75)

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
- `node/agent/check/corpus-hand-shaped-lines.json`
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
- `node/agent/check/corpus-w2-blocking-backoff.json`
- `node/agent/check/corpus-w2-broker-dlq.json`
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
- `node/agent/check/rag-assistant.json`
- `node/agent/check/retry-storm.json`
- `node/agent/check/vendor-edge-storefront.json`
- `node/agent/check/video-on-demand-pipeline.json`
- `node/agent/check/webhook-ingestion.json`
- `node/agent/check/where-the-time-goes.json`
- `node/agent/check/zone-outage-drill.json`
- `node/agent/describe/corpus-w2-blocking-backoff.json`
- `node/agent/describe/corpus-w2-broker-dlq.json`
- `node/agent/describe/corpus-w2-budget.json`
- `node/agent/describe/corpus-w2-exponential.json`
- `node/agent/describe/corpus-w2-fixed.json`
- `node/agent/describe/corpus-w2-jitter.json`
- `node/agent/describe/corpus-w2-pool-deadline.json`
- `node/agent/describe/corpus-w2-sampling.json`
- `node/agent/describe/retry-storm.json`
- `node/agent/describe/w2-slow-payment-provider.json`
- `node/agent/tools.json`

## node/checks (136)

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
- `node/checks/corpus-hand-shaped-lines.json`
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
- `node/checks/vendor-edge-storefront.json`
- `node/checks/video-on-demand-pipeline.json`
- `node/checks/w2-slow-payment-provider.json`
- `node/checks/webhook-ingestion.json`
- `node/checks/where-the-time-goes.json`
- `node/checks/zone-outage-drill.json`

## node/checks-words (64)

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
- `node/checks-words/corpus-hand-shaped-lines.json`
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
- `node/checks-words/corpus-w2-blocking-backoff.json`
- `node/checks-words/corpus-w2-broker-dlq.json`
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
- `node/checks-words/rag-assistant.json`
- `node/checks-words/retry-storm.json`
- `node/checks-words/vendor-edge-storefront.json`
- `node/checks-words/video-on-demand-pipeline.json`
- `node/checks-words/webhook-ingestion.json`
- `node/checks-words/where-the-time-goes.json`
- `node/checks-words/zone-outage-drill.json`

## node/evidence (46)

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
- `node/evidence/corpus-w2-blocking-backoff.json`
- `node/evidence/corpus-w2-broker-dlq.json`
- `node/evidence/corpus-w2-budget.json`
- `node/evidence/corpus-w2-exponential.json`
- `node/evidence/corpus-w2-fixed.json`
- `node/evidence/corpus-w2-jitter.json`
- `node/evidence/corpus-w2-pool-deadline.json`
- `node/evidence/corpus-w2-sampling.json`
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
- `node/evidence/rag-assistant.json`
- `node/evidence/retry-storm.json`
- `node/evidence/video-on-demand-pipeline.json`
- `node/evidence/webhook-ingestion.json`
- `node/evidence/where-the-time-goes.json`

## node/i18n (1)

- `node/i18n/catalogs.json`

## node/skill (4)

- `node/skill/corpus-hand-shaped-lines.files.json`
- `node/skill/corpus-hand-shaped-lines.public-schemas.json`
- `node/skill/files.json`
- `node/skill/public-schemas.json`
