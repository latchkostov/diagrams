## Readable node identity at every zoom

Nodes keep their icons and titles in Edit, Live, Overview, Focus and Following.
Titles counter-scale to a 9.5 px screen floor and use measured ellipses or word initials
inside their own card width. Icons retain about 14 screen pixels, filling a smaller
card's height when necessary. Secondary text keeps its existing hide floor.

Overview retains individual services, zone bands, tints and contrasting outlines.
A header with no free internal band moves above the zone, clear of neighbouring cards.
Card, Compact and Icon styles share the rule. Image capture measures identity at its
export scale, so a small editor zoom does not change the exported drawing.

The startup and Live limits and the 835,000-byte skill ZIP cap are unchanged. Identity
truncation helpers load with the detail surface that needs them. No new controls,
simulation behaviour, public examples or translation messages are added.

## Verification and review

Unit coverage spans zoom 0.1–1.5, title containment, initials, icon sizing and unchanged
secondary-text hiding. Deliberately hiding titles, restoring natural-only icon sizes,
removing truncation and showing secondary text below its floor each failed the regression.
The browser checks every node's painted identity, font floor and containment in both
screenshots' examples, including all three node styles for delivery-dispatch at 35% and
24%. Light/dark captures are saved under the requested fu2b directory.

The loaded Linux run also exposed a non-atomic inspector geometry assertion: the retry
section could finish expanding between its two field reads. Both fields and the sheet
are now sampled in one browser evaluation, keeping the same exact spacing assertions.

## Intentional parity changes

All Node-tier simulation, planning, schema, catalogue and agent goldens are unchanged.
Every changed browser golden is listed below. Layout node positions, node boxes, edge
routes and edge-label placements stay unchanged. Three opening fits reserve slightly
more room while the counter-scaled identity is measured; their scale decreases by
about 1–1.4%. Exported PNG/SVG artwork remains at its authored scale.

| Golden under tests/parity/goldens/                      | Reason                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser/html/branch-to-datacentre.dark.png`            | Read-only HTML viewer screenshot retains counter-scaled icons and titles at its fitted zoom.                                                                                                                              |
| `browser/html/kafka-order-pipeline.dark.png`            | Read-only HTML viewer screenshot retains counter-scaled icons and titles at its fitted zoom.                                                                                                                              |
| `browser/images/aks-app-config-key-vault.dark.svg.txt`  | SVG DOM snapshot includes card-icon test identifiers and the title column filling its available width; exported artwork stays at authored scale.                                                                          |
| `browser/images/aks-app-config-key-vault.light.svg.txt` | SVG DOM snapshot includes card-icon test identifiers and the title column filling its available width; exported artwork stays at authored scale.                                                                          |
| `browser/images/branch-to-datacentre.dark.svg.txt`      | SVG DOM snapshot includes card-icon test identifiers and the title column filling its available width; exported artwork stays at authored scale.                                                                          |
| `browser/images/branch-to-datacentre.light.svg.txt`     | SVG DOM snapshot includes card-icon test identifiers and the title column filling its available width; exported artwork stays at authored scale.                                                                          |
| `browser/images/corpus-hand-shaped-lines.dark.svg.txt`  | SVG DOM snapshot includes card-icon test identifiers and the title column filling its available width; exported artwork stays at authored scale.                                                                          |
| `browser/images/corpus-hand-shaped-lines.light.svg.txt` | SVG DOM snapshot includes card-icon test identifiers and the title column filling its available width; exported artwork stays at authored scale.                                                                          |
| `browser/images/kafka-order-pipeline.dark.svg.txt`      | SVG DOM snapshot includes card-icon test identifiers and the title column filling its available width; exported artwork stays at authored scale.                                                                          |
| `browser/images/kafka-order-pipeline.light.svg.txt`     | SVG DOM snapshot includes card-icon test identifiers and the title column filling its available width; exported artwork stays at authored scale.                                                                          |
| `browser/layout/aws-serverless-orders.json`             | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/azure-service-bus-integration.json`     | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/black-friday-commerce.json`             | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/blocking-call.json`                     | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/branch-to-datacentre.json`              | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/cell-based-bookings.json`               | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/cqrs-event-sourcing.json`               | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/delivery-dispatch.json`                 | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/ev-charging-network.json`               | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/event-driven-data-platform.json`        | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/gcp-streaming-analytics.json`           | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/hybrid-enterprise-network.json`         | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/kafka-order-pipeline.json`              | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/notification-fanout.json`               | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/observability-pipeline.json`            | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/outbox-saga-checkout.json`              | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/payments-ledger.json`                   | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/recommendations-feature-store.json`     | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/scale-on-busy-threads.json`             | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/serverless-burst-buffer.json`           | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/video-on-demand-pipeline.json`          | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/layout/webhook-ingestion.json`                 | Auto-layout/Tidy now record visible, card-width-truncated names instead of hidden or overflowing full text.                                                                                                               |
| `browser/render/aks-app-config-key-vault.json`          | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/aws-serverless-orders.json`             | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/azure-service-bus-integration.json`     | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/blocking-call.json`                     | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/branch-to-datacentre.json`              | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/cqrs-event-sourcing.json`               | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/event-driven-data-platform.json`        | Opening canvas now records visible, card-width-truncated names. Initial fit also reserves room for the identity floor: translate(7.39623px, 192.725px) scale(0.615094) → translate(7.66029px, 195.207px) scale(0.608493). |
| `browser/render/gcp-streaming-analytics.json`           | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/kafka-order-pipeline.json`              | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/notification-fanout.json`               | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/outbox-saga-checkout.json`              | Opening canvas now records visible, card-width-truncated names. Initial fit also reserves room for the identity floor: translate(11.136px, 217.446px) scale(0.5216) → translate(11.4241px, 220.298px) scale(0.514398).    |
| `browser/render/scale-on-busy-threads.json`             | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/serverless-burst-buffer.json`           | Opening canvas now records visible, card-width-truncated names.                                                                                                                                                           |
| `browser/render/webhook-ingestion.json`                 | Opening canvas now records visible, card-width-truncated names. Initial fit also reserves room for the identity floor: translate(11.1776px, 217.859px) scale(0.520559) → translate(11.4646px, 220.699px) scale(0.513386). |
