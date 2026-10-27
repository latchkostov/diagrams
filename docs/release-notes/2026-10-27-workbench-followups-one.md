## Workbench framing, connections and readable detail

Follow keeps every narrated card inside the visible canvas. When a subject-centred close-up would lose another narrated card, it frames the whole narration, leaving other neighbours as named pins. This also applies on phones; a narrated caller is a card rather than a pin.

Selected connections and narrated neighbours stay at or below two screen pixels. Connections of a selected node use the accent. Parallel automatic routes receive eight-pixel screen-space lanes. Pins have reserved top and bottom rows, above the legend; their connections avoid cards and other pins. Unretained routes stop before those rows. Removing the redundant straight pin leader fixes the diagonal beside Checkout saga.

The selected neighbourhood's subtitles and connection labels reach an effective 11 px where their complete enlarged boxes fit. Candidate placements avoid cards, other labels and other routes; otherwise the existing detail behaviour remains. Card dimensions and authored diagram coordinates stay unchanged.

## Skill download trim

The skill ZIP shrinks from **833,516 B to 827,220 B**, saving **6,296 B** with the 835,000 B cap unchanged. Only the compressed offline viewer entry changes; every skill file, icon, font and script remains.

- The viewer imports drawing styles without the inspector, stencil palette, onboarding or quick-add styles. Their components were already excluded from the read-only viewer.
- Shared UI styles are separated from the editor's application grid, segmented selectors, AI dock, library/thumbnails, diagram picker and bezel. The editor still imports both in cascade order. The viewer keeps shared controls, canvas styling, languages and toast typography.

Extra JavaScript minification was rejected because it increased the compressed ZIP. A same-run regression restores the editor CSS to verify at least 6 KiB of compression savings; the existing deterministic ZIP, round-trip, asset and cap checks remain.

## Output and verification

Camera lanes, pins and text placement are temporary presentation geometry and are suspended for image capture. Simulation results, authored diagram data and exported pixels are unchanged. Only the intentional label snapshots listed below are re-recorded.

Each regression has a mutation check. Public examples supply the light/dark Editing and large Live captures in the follow-up capture folder. The unchanged layout assertions, camera/frame/trace checks, Linux load repetitions, skill checks, build and entry/viewer budgets cover this batch.

## Intentional parity changes

Exactly 18 goldens change, all under `tests/parity/goldens/browser/layout/`, and only in `tidy.labels`. Their Auto-layout results, node boxes, routes and viewports remain identical. At the retained 90% Focus zoom, qualifying labels use 12.223 flow pixels to clear the 11 px screen floor. Labels may slide along their own route to clear cards and pins; labels of omitted endpoints are culled. The full list follows.

| Golden                               | Change                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `aks-app-config-key-vault.json`      | 11 px label floor; collision-free positions on the same routes.                                                                                |
| `aws-serverless-orders.json`         | 11 px label floor; collision-free positions on the same routes; newly visible “Rule: OrderPaid”, “SMS”, “Rule: all orders”.                    |
| `azure-service-bus-integration.json` | 11 px label floor; collision-free positions on the same routes.                                                                                |
| `black-friday-commerce.json`         | 11 px label floor; collision-free positions on the same routes; newly visible “Order + outbox”.                                                |
| `cdc-analytics.json`                 | 11 px label floor; collision-free positions on the same routes.                                                                                |
| `cell-based-bookings.json`           | 11 px label floor; collision-free positions on the same routes; “Replication” is culled after pin/label placement.                             |
| `contoso-dmz.json`                   | 11 px label floor.                                                                                                                             |
| `delivery-dispatch.json`             | 11 px label floor; collision-free positions on the same routes; newly visible “Score pairs”, “Best match”, “Maps key”.                         |
| `ev-charging-network.json`           | 11 px label floor; collision-free positions on the same routes; newly visible “HTTPS”.                                                         |
| `event-driven-data-platform.json`    | 11 px label floor; collision-free positions on the same routes; newly visible “OrderPlaced”, “AccountChanged”.                                 |
| `gcp-streaming-analytics.json`       | 11 px label floor; collision-free positions on the same routes.                                                                                |
| `hybrid-enterprise-network.json`     | 11 px label floor; collision-free positions on the same routes; newly visible “SMB”; “Allow: inside apps” is culled after pin/label placement. |
| `observability-pipeline.json`        | 11 px label floor; collision-free positions on the same routes; newly visible “OTLP/gRPC”, “OTLP/gRPC”.                                        |
| `outbox-saga-checkout.json`          | 11 px label floor; collision-free positions on the same routes; newly visible “WAL”, “Reserved / Released”.                                    |
| `payments-ledger.json`               | 11 px label floor; collision-free positions on the same routes; newly visible “Authorize”, “Record + outbox”.                                  |
| `rag-assistant.json`                 | 11 px label floor; collision-free positions on the same routes.                                                                                |
| `recommendations-feature-store.json` | 11 px label floor; collision-free positions on the same routes; newly visible “Features”, “Features”, “Write features”.                        |
| `video-on-demand-pipeline.json`      | 11 px label floor; collision-free positions on the same routes.                                                                                |

All simulation, schema, rendered/exported image and other golden outputs stay unchanged. The CSS trim changes the offline viewer’s bytes without changing its rendered output.
