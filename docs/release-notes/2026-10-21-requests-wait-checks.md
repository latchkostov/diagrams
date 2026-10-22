## Requests that wait (5/5): Checks and agents parity

Checks now explain when calls exhaust a service's threads, when CPU scaling misses those waits, and when an
outside or model API call has no timeout. Fully blocking request cycles explain their deadlock risk.
`blocked-threads` uses #225's verified selector for its primary action. The callout, Check and planner share
the exact scaling policy; Free the thread and Add replicas are secondary chips when scaling wins. An
autoscaled service's Add replicas alternative names a fixed fleet and disables its scaler in the same step.

Timeout values reuse `affordableTimeout`, superseding the design's 4× expected response, 1–2–5 rounding and
one-second floor. The payment lesson gets the same verified 600 ms value as its callout. No value is offered
when the normal reply cannot fit within the caller's thread budget. Checks keep their configured-rate scope;
saved drills can deliberately overload the same service. Informational timeout findings use the existing
suggestion tier. All changes remain undoable.

`describe_diagram` exposes `requestsWait.threads`, `holdMs` and `ceilingPerSec`. Agent schemas accept the three
new Check ids and the `threadsBusy` / `threadsWaiting` expectation metrics. Those chips measure real threads
at every sampling scale. New UI text translates at render time; agent and worker output remains English.
The existing Requests that wait gallery lessons cover the feature, with Check tests for the blocking,
CPU-scaling and merged payment examples. The simulation guide and agent skill document the completed model.

The worker returns its complete verified waiting findings for agent and UI rechecks, including findings
whose rules are off. Turning checks off and back on cannot replace that cache with a filtered result or
make a generic capacity finding disagree with the worker.

## Output parity

Exactly 329 existing goldens change intentionally; none are added or removed. The inventory below names
every file, relative to `tests/parity/goldens/`, grouped by its reason. All simulation, trace, planning,
export, layout, renderer and image goldens remain unchanged. Checks' evidence wrappers change only for
nested Check results; simulation loss evidence does not change.

The entry bundle is 108.2 kB gzip (123.5 kB budget). The skill ZIP is 834,638 B (835,000 B cap); no
budget was raised and no skill content had to be trimmed.

## Golden inventory: node/agent (1)

Tool descriptions and input schemas list the new rules and expectation metrics.

```text
node/agent/tools.json
```

## Golden inventory: node/agent/check (68)

Agent Check summaries count the three new rules. W1 results additionally report blocked threads, CPU-blind scaling, absent deadlines and deadlock wording. Fix values come from the shared selector and timeout function.

```text
node/agent/check/aks-app-config-key-vault.json
node/agent/check/autoscaling-basics.json
node/agent/check/aws-serverless-orders.json
node/agent/check/azure-service-bus-integration.json
node/agent/check/black-friday-commerce.json
node/agent/check/blocking-call.json
node/agent/check/branch-to-datacentre.json
node/agent/check/cdc-analytics.json
node/agent/check/cell-based-bookings.json
node/agent/check/contoso-dmz.json
node/agent/check/corpus-a1-burst-scale-up.json
node/agent/check/corpus-a1-downscale-stabilization.json
node/agent/check/corpus-a1-idle-partitions.json
node/agent/check/corpus-a1-image-workers.json
node/agent/check/corpus-a1-startup-backlog.json
node/agent/check/corpus-a2-idle.json
node/agent/check/corpus-a3-aca-http.json
node/agent/check/corpus-a3-app-service.json
node/agent/check/corpus-a3-cloud-run.json
node/agent/check/corpus-annotation-course.json
node/agent/check/corpus-back-edges.json
node/agent/check/corpus-check-sync-chain-3.json
node/agent/check/corpus-custom-colours.json
node/agent/check/corpus-cycle.json
node/agent/check/corpus-export-contract.json
node/agent/check/corpus-fan-edges.json
node/agent/check/corpus-fan-out.json
node/agent/check/corpus-header-overflow.json
node/agent/check/corpus-layers.json
node/agent/check/corpus-p3-api-gateway.json
node/agent/check/corpus-p3-lambda.json
node/agent/check/corpus-p3-openai.json
node/agent/check/corpus-p3-stripe.json
node/agent/check/corpus-r1-callers.json
node/agent/check/corpus-r1-mix-table.json
node/agent/check/corpus-r1-quotas.json
node/agent/check/corpus-scenario-sim-fan-out.json
node/agent/check/corpus-scenario-sim-gateway-round-robin.json
node/agent/check/corpus-text-fields.json
node/agent/check/corpus-w1-blocking.json
node/agent/check/corpus-w1-busy-threads.json
node/agent/check/corpus-w1-gateway.json
node/agent/check/corpus-w1-held-drain.json
node/agent/check/corpus-w1-inflight-cap.json
node/agent/check/corpus-w1-join-failure.json
node/agent/check/corpus-w1-loop.json
node/agent/check/corpus-w1-nonblocking.json
node/agent/check/corpus-w1-pool.json
node/agent/check/corpus-w1-sampling.json
node/agent/check/cqrs-event-sourcing.json
node/agent/check/delivery-dispatch.json
node/agent/check/ev-charging-network.json
node/agent/check/event-driven-data-platform.json
node/agent/check/gcp-streaming-analytics.json
node/agent/check/hybrid-enterprise-network.json
node/agent/check/kafka-order-pipeline.json
node/agent/check/nightly-batch-elt.json
node/agent/check/notification-fanout.json
node/agent/check/observability-pipeline.json
node/agent/check/payments-ledger.json
node/agent/check/rag-assistant.json
node/agent/check/recommendations-feature-store.json
node/agent/check/scale-on-busy-threads.json
node/agent/check/slow-payment-provider.json
node/agent/check/video-on-demand-pipeline.json
node/agent/check/webhook-ingestion.json
node/agent/check/where-the-time-goes.json
node/agent/check/zone-outage-drill.json
```

## Golden inventory: node/agent/describe (13)

W1 callers gain explicit requestsWait thread count, hold milliseconds and ceiling fields; their existing scenario descriptions remain intact.

```text
node/agent/describe/blocking-call.json
node/agent/describe/corpus-w1-blocking.json
node/agent/describe/corpus-w1-busy-threads.json
node/agent/describe/corpus-w1-deadline.json
node/agent/describe/corpus-w1-held-drain.json
node/agent/describe/corpus-w1-inflight-cap.json
node/agent/describe/corpus-w1-join-failure.json
node/agent/describe/corpus-w1-loop.json
node/agent/describe/corpus-w1-nonblocking.json
node/agent/describe/corpus-w1-pool.json
node/agent/describe/corpus-w1-sampling.json
node/agent/describe/scale-on-busy-threads.json
node/agent/describe/slow-payment-provider.json
```

## Golden inventory: node/checks (124)

The registry and ran lists gain three rules. W1 findings and the harness’s apply-fix/recheck records gain the intended diagnostics and shared fixes.

```text
node/checks/aks-app-config-key-vault.json
node/checks/api-route-table.json
node/checks/autoscaling-basics.json
node/checks/aws-serverless-orders.json
node/checks/azure-service-bus-integration.json
node/checks/black-friday-commerce.json
node/checks/blocking-call.json
node/checks/branch-to-datacentre.json
node/checks/cdc-analytics.json
node/checks/cell-based-bookings.json
node/checks/cloud-run-timetable-api.json
node/checks/contoso-dmz.json
node/checks/corpus-a1-burst-scale-up.json
node/checks/corpus-a1-downscale-stabilization.json
node/checks/corpus-a1-idle-partitions.json
node/checks/corpus-a1-image-workers.json
node/checks/corpus-a1-max-reached.json
node/checks/corpus-a1-startup-backlog.json
node/checks/corpus-a2-activation.json
node/checks/corpus-a2-cooldown.json
node/checks/corpus-a2-idle.json
node/checks/corpus-a2-render-workers.json
node/checks/corpus-a3-aca-event.json
node/checks/corpus-a3-aca-http.json
node/checks/corpus-a3-app-service.json
node/checks/corpus-a3-cloud-run.json
node/checks/corpus-a3-ecs-alb.json
node/checks/corpus-a3-ecs-step.json
node/checks/corpus-a3-planner-max.json
node/checks/corpus-a3-planner-partitions.json
node/checks/corpus-a3-planner-quota.json
node/checks/corpus-a3-planner-target.json
node/checks/corpus-annotation-course.json
node/checks/corpus-back-edges.json
node/checks/corpus-check-load-100.json
node/checks/corpus-check-load-79.json
node/checks/corpus-check-load-80.json
node/checks/corpus-check-load-99.json
node/checks/corpus-check-sync-chain-3.json
node/checks/corpus-check-sync-chain-4.json
node/checks/corpus-checks-checkout-shortcuts.json
node/checks/corpus-checks-payments-ledger.json
node/checks/corpus-checks-shared-ids.json
node/checks/corpus-custom-colours.json
node/checks/corpus-cycle.json
node/checks/corpus-edge-kinds.json
node/checks/corpus-edge-relations.json
node/checks/corpus-edge-sides.json
node/checks/corpus-export-contract.json
node/checks/corpus-fan-edges.json
node/checks/corpus-fan-out.json
node/checks/corpus-groups.json
node/checks/corpus-header-overflow.json
node/checks/corpus-layers.json
node/checks/corpus-obstacle-course.json
node/checks/corpus-odd-nodes.json
node/checks/corpus-p3-api-gateway.json
node/checks/corpus-p3-external-api.json
node/checks/corpus-p3-lambda.json
node/checks/corpus-p3-openai-shared.json
node/checks/corpus-p3-openai.json
node/checks/corpus-p3-shared-quota.json
node/checks/corpus-p3-stripe.json
node/checks/corpus-planning-analysis-limit.json
node/checks/corpus-planning-connections.json
node/checks/corpus-planning-many-groups.json
node/checks/corpus-planning-no-reader.json
node/checks/corpus-planning-orders.json
node/checks/corpus-planning-outage.json
node/checks/corpus-planning-p2-kafka.json
node/checks/corpus-planning-p2-kinesis.json
node/checks/corpus-planning-p2-queue.json
node/checks/corpus-planning-p2-sns.json
node/checks/corpus-r1-callers.json
node/checks/corpus-r1-mix-table.json
node/checks/corpus-r1-overlap.json
node/checks/corpus-r1-quotas.json
node/checks/corpus-relationships.json
node/checks/corpus-scenario-sim-competing-consumers.json
node/checks/corpus-scenario-sim-dlq.json
node/checks/corpus-scenario-sim-fan-out.json
node/checks/corpus-scenario-sim-gateway-round-robin.json
node/checks/corpus-scenario-sim-slow-consumer.json
node/checks/corpus-scenario-sim-traffic-storm.json
node/checks/corpus-sim-review-diagnostic.json
node/checks/corpus-sim-review.json
node/checks/corpus-text-fields.json
node/checks/corpus-w1-blocking.json
node/checks/corpus-w1-busy-threads.json
node/checks/corpus-w1-deadline.json
node/checks/corpus-w1-gateway.json
node/checks/corpus-w1-held-drain.json
node/checks/corpus-w1-inflight-cap.json
node/checks/corpus-w1-join-failure.json
node/checks/corpus-w1-loop.json
node/checks/corpus-w1-nonblocking.json
node/checks/corpus-w1-pool.json
node/checks/corpus-w1-sampling.json
node/checks/cqrs-event-sourcing.json
node/checks/delivery-dispatch.json
node/checks/ev-charging-network.json
node/checks/event-driven-data-platform.json
node/checks/gcp-streaming-analytics.json
node/checks/hybrid-enterprise-network.json
node/checks/kafka-order-pipeline.json
node/checks/measured-order-capacity.json
node/checks/nightly-batch-elt.json
node/checks/notification-fanout.json
node/checks/observability-pipeline.json
node/checks/outbox-saga-checkout.json
node/checks/partitions-vs-subscriptions.json
node/checks/payments-ledger.json
node/checks/rag-assistant.json
node/checks/recommendations-feature-store.json
node/checks/rules.json
node/checks/scale-on-busy-threads.json
node/checks/serverless-burst-buffer.json
node/checks/shared-api-quotas.json
node/checks/shared-worker-pool.json
node/checks/slow-payment-provider.json
node/checks/video-on-demand-pipeline.json
node/checks/webhook-ingestion.json
node/checks/where-the-time-goes.json
node/checks/zone-outage-drill.json
```

## Golden inventory: node/checks-words (68)

English Check summaries and rendered rationale reflect those new rules, the W1 diagnostics, the fixed-replica alternatives and deadlock wording.

```text
node/checks-words/aks-app-config-key-vault.json
node/checks-words/autoscaling-basics.json
node/checks-words/aws-serverless-orders.json
node/checks-words/azure-service-bus-integration.json
node/checks-words/black-friday-commerce.json
node/checks-words/blocking-call.json
node/checks-words/branch-to-datacentre.json
node/checks-words/cdc-analytics.json
node/checks-words/cell-based-bookings.json
node/checks-words/contoso-dmz.json
node/checks-words/corpus-a1-burst-scale-up.json
node/checks-words/corpus-a1-downscale-stabilization.json
node/checks-words/corpus-a1-idle-partitions.json
node/checks-words/corpus-a1-image-workers.json
node/checks-words/corpus-a1-startup-backlog.json
node/checks-words/corpus-a2-idle.json
node/checks-words/corpus-a3-aca-http.json
node/checks-words/corpus-a3-app-service.json
node/checks-words/corpus-a3-cloud-run.json
node/checks-words/corpus-annotation-course.json
node/checks-words/corpus-back-edges.json
node/checks-words/corpus-check-sync-chain-3.json
node/checks-words/corpus-custom-colours.json
node/checks-words/corpus-cycle.json
node/checks-words/corpus-export-contract.json
node/checks-words/corpus-fan-edges.json
node/checks-words/corpus-fan-out.json
node/checks-words/corpus-header-overflow.json
node/checks-words/corpus-layers.json
node/checks-words/corpus-p3-api-gateway.json
node/checks-words/corpus-p3-lambda.json
node/checks-words/corpus-p3-openai.json
node/checks-words/corpus-p3-stripe.json
node/checks-words/corpus-r1-callers.json
node/checks-words/corpus-r1-mix-table.json
node/checks-words/corpus-r1-quotas.json
node/checks-words/corpus-scenario-sim-fan-out.json
node/checks-words/corpus-scenario-sim-gateway-round-robin.json
node/checks-words/corpus-text-fields.json
node/checks-words/corpus-w1-blocking.json
node/checks-words/corpus-w1-busy-threads.json
node/checks-words/corpus-w1-gateway.json
node/checks-words/corpus-w1-held-drain.json
node/checks-words/corpus-w1-inflight-cap.json
node/checks-words/corpus-w1-join-failure.json
node/checks-words/corpus-w1-loop.json
node/checks-words/corpus-w1-nonblocking.json
node/checks-words/corpus-w1-pool.json
node/checks-words/corpus-w1-sampling.json
node/checks-words/cqrs-event-sourcing.json
node/checks-words/delivery-dispatch.json
node/checks-words/ev-charging-network.json
node/checks-words/event-driven-data-platform.json
node/checks-words/gcp-streaming-analytics.json
node/checks-words/hybrid-enterprise-network.json
node/checks-words/kafka-order-pipeline.json
node/checks-words/nightly-batch-elt.json
node/checks-words/notification-fanout.json
node/checks-words/observability-pipeline.json
node/checks-words/payments-ledger.json
node/checks-words/rag-assistant.json
node/checks-words/recommendations-feature-store.json
node/checks-words/scale-on-busy-threads.json
node/checks-words/slow-payment-provider.json
node/checks-words/video-on-demand-pipeline.json
node/checks-words/webhook-ingestion.json
node/checks-words/where-the-time-goes.json
node/checks-words/zone-outage-drill.json
```

## Golden inventory: node/evidence (52)

Nested Check results and their summaries reflect the added rules and findings. Simulation evidence itself, including loss counts, is unchanged.

```text
node/evidence/aks-app-config-key-vault.json
node/evidence/autoscaling-basics.json
node/evidence/aws-serverless-orders.json
node/evidence/azure-service-bus-integration.json
node/evidence/black-friday-commerce.json
node/evidence/blocking-call.json
node/evidence/branch-to-datacentre.json
node/evidence/cdc-analytics.json
node/evidence/cell-based-bookings.json
node/evidence/contoso-dmz.json
node/evidence/corpus-a1-burst-scale-up.json
node/evidence/corpus-a1-downscale-stabilization.json
node/evidence/corpus-a1-idle-partitions.json
node/evidence/corpus-a1-image-workers.json
node/evidence/corpus-a1-startup-backlog.json
node/evidence/corpus-a2-idle.json
node/evidence/corpus-a3-aca-http.json
node/evidence/corpus-a3-app-service.json
node/evidence/corpus-a3-cloud-run.json
node/evidence/corpus-export-contract.json
node/evidence/corpus-p3-stripe.json
node/evidence/corpus-r1-callers.json
node/evidence/corpus-r1-mix-table.json
node/evidence/corpus-r1-quotas.json
node/evidence/corpus-w1-blocking.json
node/evidence/corpus-w1-busy-threads.json
node/evidence/corpus-w1-gateway.json
node/evidence/corpus-w1-held-drain.json
node/evidence/corpus-w1-inflight-cap.json
node/evidence/corpus-w1-join-failure.json
node/evidence/corpus-w1-loop.json
node/evidence/corpus-w1-nonblocking.json
node/evidence/corpus-w1-pool.json
node/evidence/corpus-w1-sampling.json
node/evidence/cqrs-event-sourcing.json
node/evidence/delivery-dispatch.json
node/evidence/ev-charging-network.json
node/evidence/event-driven-data-platform.json
node/evidence/gcp-streaming-analytics.json
node/evidence/hybrid-enterprise-network.json
node/evidence/kafka-order-pipeline.json
node/evidence/nightly-batch-elt.json
node/evidence/notification-fanout.json
node/evidence/observability-pipeline.json
node/evidence/payments-ledger.json
node/evidence/rag-assistant.json
node/evidence/recommendations-feature-store.json
node/evidence/scale-on-busy-threads.json
node/evidence/slow-payment-provider.json
node/evidence/video-on-demand-pipeline.json
node/evidence/webhook-ingestion.json
node/evidence/where-the-time-goes.json
```

## Golden inventory: node/i18n (1)

The new Check/metric messages and Arabic translations change catalog counts and hashes.

```text
node/i18n/catalogs.json
```

## Golden inventory: node/skill (2)

Skill text/spec fingerprints and public schema fingerprints change for the completed waiting documentation and shared metric enum (including previously omitted existing metrics).

```text
node/skill/files.json
node/skill/public-schemas.json
```
