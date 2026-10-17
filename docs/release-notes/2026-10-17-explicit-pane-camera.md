## Explicit pane camera rules

Inspector opens caused by selection or placement preserve zoom and camera ownership. Once a menu closes, a covered selection receives only a reveal pan; an uncovered placement stays at the pointer. Explicit panel toggles and resizes still refit a camera owned by Fit. Context menus and quick-add without a pick defer that panel refit until dismissal; a pick replaces it with the placement reveal. Shift+2 retains priority over a deferred reveal.

Removed the node-count, placement flag, naming-state and quick-add skips from the previous rounds. Pane work now records `panel` or `selection`, and reveal animations use linear interpolation to avoid capturing transient zoom from overlapping pans. The T regression again starts with the Inspector folded instead of pre-opening it and forcing 100% zoom.

## Output parity

Exactly 27 `browser/layout/*.json` goldens change only `tidy.viewport`: Select all opens the Inspector without refitting, so Tidy retains the preceding zoom and minimally reveals its selection. Node coordinates, edge paths, labels, Auto-layout, initial renderings, simulations and exports are unchanged. The affected files are:

- `aks-app-config-key-vault.json`
- `api-route-table.json`
- `autoscaling-image-workers.json`
- `aws-fanout.json`
- `aws-serverless-orders.json`
- `azure-service-bus-integration.json`
- `branch-to-datacentre.json`
- `cdc-analytics.json`
- `cloud-run-timetable-api.json`
- `contoso-dmz.json`
- `cqrs-event-sourcing.json`
- `event-driven-data-platform.json`
- `gcp-streaming-analytics.json`
- `iot-telemetry.json`
- `kafka-order-pipeline.json`
- `keda-render-workers.json`
- `measured-order-capacity.json`
- `multi-region-active-active.json`
- `nightly-batch-elt.json`
- `notification-fanout.json`
- `outbox-saga-checkout.json`
- `partitions-vs-subscriptions.json`
- `rag-assistant.json`
- `serverless-burst-buffer.json`
- `shared-api-quotas.json`
- `shared-worker-pool.json`
- `webhook-ingestion.json`

The delayed ResizeObserver regression remains unchanged: a reveal waits for delivered pane/node measurements before clearing its pending work.
