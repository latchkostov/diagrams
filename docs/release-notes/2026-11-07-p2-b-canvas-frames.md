## Canvas frames

Frame connections now share their displayed route across the line, selection halo, pointer target,
captions, call pills and dependency popovers. Complete connections use those lanes for editing too.
Image capture restores the natural geometry, then reapplies the frame when capture ends.

Message and Request captions keep readable text without requiring a selection. Enlarged captions slide
along their connection, clear of cards, solid annotations, boundary headers and other captions, or hide
when no clear position exists. Rejected enlargement restores font, width, height, line height and translation;
the caption returns when the obstruction moves away. The 10.5 px floor is unchanged.

## Batch disposition

| Item   | Status         | Evidence                                                                                                                                                                                                                     |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T05.01 | Fixed          | Shared effective route and capture restoration in `FrameDetail.tsx`; path, capture and caption regressions. Pin editing is covered by the decision below.                                                                    |
| T05.02 | Needs decision | Visible lane controls and hit targets agree. Temporary pin routes retain existing editing geometry until the owner decides how shaping should treat the hidden tail; see the dated backlog fragment.                         |
| T06.01 | Fixed          | Unselected Message/Request text-floor regressions and the unchanged public-example overlap audit.                                                                                                                            |
| T06.02 | Fixed          | Rendered card and note obstruction regressions verify complete style restoration and recovery.                                                                                                                               |
| T07.01 | Already fixed  | `FrameDetail.tsx:610` (introduced in `405da298c`) sends the complete mixed fan through one `frameLanes` result, with no separate dependency-spacing rule. Added accepted/rejected packing and mixed-fan hit-target coverage. |

## Output parity

The full check compared 3,377 goldens and found 41 intended changes. The browser render, image and selection tiers were then recorded explicitly. Every changed golden below is under `tests/parity/goldens/browser/`.

Displayed paths now record the same clipped or packed route as the visible stroke, including after Tidy. Caption styles record the readable font, complete measured box and collision-free translation; caption visibility records hiding text when that readable box cannot fit. Handle clearance follows the displayed caption bounds. The eight SVG structures differ only by the new halo and hit-target test IDs: removing those IDs reproduces the old structures exactly.

Node outputs, node geometry, viewports, Interactive HTML and PNG goldens are unchanged. No budgets or tolerances changed.

| Golden                                          | Intended difference                                  |
| ----------------------------------------------- | ---------------------------------------------------- |
| `images/aks-app-config-key-vault.dark.svg.txt`  | SVG test IDs.                                        |
| `images/aks-app-config-key-vault.light.svg.txt` | SVG test IDs.                                        |
| `images/branch-to-datacentre.dark.svg.txt`      | SVG test IDs.                                        |
| `images/branch-to-datacentre.light.svg.txt`     | SVG test IDs.                                        |
| `images/corpus-hand-shaped-lines.dark.svg.txt`  | SVG test IDs.                                        |
| `images/corpus-hand-shaped-lines.light.svg.txt` | SVG test IDs.                                        |
| `images/kafka-order-pipeline.dark.svg.txt`      | SVG test IDs.                                        |
| `images/kafka-order-pipeline.light.svg.txt`     | SVG test IDs.                                        |
| `layout/aks-app-config-key-vault.json`          | caption styles.                                      |
| `layout/aws-serverless-orders.json`             | displayed paths, caption styles, caption visibility. |
| `layout/azure-service-bus-integration.json`     | displayed paths, caption styles.                     |
| `layout/black-friday-commerce.json`             | displayed paths, caption styles, caption visibility. |
| `layout/cdc-analytics.json`                     | caption visibility, caption styles.                  |
| `layout/cell-based-bookings.json`               | displayed paths, caption styles, caption visibility. |
| `layout/contoso-dmz.json`                       | caption styles.                                      |
| `layout/delivery-dispatch.json`                 | displayed paths, caption styles, caption visibility. |
| `layout/ev-charging-network.json`               | displayed paths, caption styles.                     |
| `layout/event-driven-data-platform.json`        | displayed paths, caption styles.                     |
| `layout/gcp-streaming-analytics.json`           | caption styles, caption visibility.                  |
| `layout/hybrid-enterprise-network.json`         | displayed paths, caption styles.                     |
| `layout/observability-pipeline.json`            | displayed paths, caption styles, caption visibility. |
| `layout/outbox-saga-checkout.json`              | displayed paths, caption styles, caption visibility. |
| `layout/payments-ledger.json`                   | displayed paths, caption styles, caption visibility. |
| `layout/rag-assistant.json`                     | caption styles, caption visibility.                  |
| `layout/recommendations-feature-store.json`     | displayed paths, caption styles, caption visibility. |
| `layout/video-on-demand-pipeline.json`          | displayed paths, caption styles.                     |
| `render/aks-app-config-key-vault.json`          | caption styles.                                      |
| `render/black-friday-commerce.json`             | displayed paths.                                     |
| `render/cdc-analytics.json`                     | caption visibility, caption styles.                  |
| `render/cell-based-bookings.json`               | displayed paths, caption styles.                     |
| `render/contoso-dmz.json`                       | caption styles.                                      |
| `render/corpus-hand-shaped-lines.json`          | caption styles.                                      |
| `render/cqrs-event-sourcing.json`               | caption styles, caption visibility.                  |
| `render/event-driven-data-platform.json`        | caption styles, caption visibility.                  |
| `render/hybrid-enterprise-network.json`         | displayed paths, caption styles.                     |
| `render/kafka-order-pipeline.json`              | caption styles, caption visibility.                  |
| `render/nightly-batch-elt.json`                 | caption styles, caption visibility.                  |
| `render/observability-pipeline.json`            | displayed paths.                                     |
| `render/rag-assistant.json`                     | caption styles, caption visibility.                  |
| `render/recommendations-feature-store.json`     | displayed paths.                                     |
| `selection/corpus-hand-shaped-lines.json`       | caption styles, handle clearance.                    |
