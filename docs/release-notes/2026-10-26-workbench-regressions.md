## Workbench interaction and playback regressions

Overview retains every node silhouette, including at very small zoom. Free-play particles remain visible without a spotlight. Search uses absolute positions for nodes inside boundaries and waits for a revealed card before handing it keyboard focus.

Switching dock tabs preserves unfinished AI input and validation feedback. Checks fixes retain their requested field focus. Phone playback exposes Inputs and AI through More, keeps Undo available in the top-bar menu, and leaves the AI footer clear of playback.

Connection handles retain their measured centre when highlighted. Connection drops snap once, after centring the new card. Fit leaves room for the grow chip. Live captions and trouble callouts avoid cards; tracing temporarily folds Properties so the trace does not shrink the canvas. Recording excludes playback chrome and retains the presentation capture area.

Existing UI tests now reach the moved View, library, dock and playback surfaces through their current controls. Render benchmarks prepare distinct, exposed targets before measurement; their budgets are unchanged. Properties avoids redundant selection commits and memoizes its stable inputs.

Request settings use the current document immediately, preserving consecutive edits and Undo. Dock throughput history samples simulation seconds without drifting. An explicit Properties command opens the dock while a floating message trace remains available.

Lab Undo and Redo controls reflect the current collaboration history, including after room edits and privacy shutdown.

Frame measurements batch width resets and reads, reuse label lookups, and remeasure only cards whose dimensions changed. Traffic-intensity styling no longer triggers geometry work. A single selected card can grow for a two-line subtitle while multi-selection stays compact. Collapsed Advanced remains reachable after the on-device controls download. Tight presentation captions prefer reduced spacing to covering a card, and trace contrast survives either stylesheet load order.

Explicit menu navigation cancels pending hover actions, so Escape keeps a dismissed submenu closed.

Output parity validation is recorded in the accompanying design review. Follow retains its documented readable camera and off-frame pins. Narration tests visit distant cards through those pins, return explicitly to Follow between visits, and retain every bounds and readability assertion.

## Deliberate output changes

Updated 24 browser layout goldens and one selection golden. Every layout change is confined to the `tidy` result: multi-selection no longer grows card geometry as the selection arrives. Ordinary canvas renders, Auto-layout results, normalized HTML, SVG and PNG exports retain their existing goldens.

All files in the following table are under `tests/parity/goldens/browser/layout/`.

| Golden                               | Reason                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `aks-app-config-key-vault.json`      | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `aws-serverless-orders.json`         | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `azure-service-bus-integration.json` | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `black-friday-commerce.json`         | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `blocking-call.json`                 | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `cdc-analytics.json`                 | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `cell-based-bookings.json`           | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `contoso-dmz.json`                   | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `delivery-dispatch.json`             | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `ev-charging-network.json`           | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `event-driven-data-platform.json`    | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `gcp-streaming-analytics.json`       | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `hybrid-enterprise-network.json`     | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `kafka-order-pipeline.json`          | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `observability-pipeline.json`        | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `outbox-saga-checkout.json`          | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `payments-ledger.json`               | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `rag-assistant.json`                 | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `recommendations-feature-store.json` | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `retry-storm.json`                   | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `scale-on-busy-threads.json`         | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `serverless-burst-buffer.json`       | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `shared-api-quotas.json`             | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |
| `video-on-demand-pipeline.json`      | Tidy uses stable 72 px cards; derived boundary bounds, routes and label positions follow those measurements. |

`tests/parity/goldens/browser/selection/corpus-hand-shaped-lines.json` changes only its three segment-handle transforms: inverse exact zoom keeps their hit targets at the promised screen size. The connection drawing is unchanged.
