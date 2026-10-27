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

## Full-run follow-ups

Complete names remain available in each title's native tooltip, including the HTML
viewer. Integration checks for copied names and peer renames verify that exact full
name, while the dedicated readability tests verify the painted abbreviation.
Identity geometry is read in one batch before titles and icon sizes are written.
A data-only edit restores the original name before measuring its natural card width,
so Undo and layout cannot shrink a card around its previous abbreviation.
The hover audit targets an exposed edge stroke rather than an SVG bounding-box centre.
Canvas snapshots wait for the detail pass at the settled zoom before comparing painted
titles. Natural-size title reservations keep truncation and counter-scaling from changing
card measurements. Icons grow within their existing tile footprint.

The complete Linux e2e run exposed existing import and Requests Checks failures,
reproduced twice on clean master and recorded in
[the follow-up fragment](../backlog/2026-10-27-import-and-checks-master-failures.md).
Other failures received focused fixes and reruns; the original full run was not green.

The full Linux run also reproduced existing import-visibility and request-Checks
failures on clean master. Their focused baseline evidence is recorded in
[the follow-up fragment](../backlog/2026-10-27-import-and-checks-master-failures.md);
none of those assertions or timeouts is changed here.

## Intentional parity changes

All 54 changed goldens are listed below. Node boxes, routes and fitted viewports are unchanged. Image-export PNG goldens are unchanged.

| Golden                                                   | Reason                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `browser/html/branch-to-datacentre.dark.png`             | Dark HTML viewer paints node identity with the shared title/icon styling.                                                          |
| `browser/html/kafka-order-pipeline.dark.png`             | Dark HTML viewer paints node identity with the shared title/icon styling.                                                          |
| `browser/images/aks-app-config-key-vault.dark.svg.json`  | Element count includes the natural-size title reservation and positioned title wrapper; geometry and rendered image are unchanged. |
| `browser/images/aks-app-config-key-vault.dark.svg.txt`   | Export DOM includes title-sizing wrappers, positioned icon artwork, and identity test IDs; rendered image is unchanged.            |
| `browser/images/aks-app-config-key-vault.light.svg.json` | Element count includes the natural-size title reservation and positioned title wrapper; geometry and rendered image are unchanged. |
| `browser/images/aks-app-config-key-vault.light.svg.txt`  | Export DOM includes title-sizing wrappers, positioned icon artwork, and identity test IDs; rendered image is unchanged.            |
| `browser/images/branch-to-datacentre.dark.svg.json`      | Element count includes the natural-size title reservation and positioned title wrapper; geometry and rendered image are unchanged. |
| `browser/images/branch-to-datacentre.dark.svg.txt`       | Export DOM includes title-sizing wrappers, positioned icon artwork, and identity test IDs; rendered image is unchanged.            |
| `browser/images/branch-to-datacentre.light.svg.json`     | Element count includes the natural-size title reservation and positioned title wrapper; geometry and rendered image are unchanged. |
| `browser/images/branch-to-datacentre.light.svg.txt`      | Export DOM includes title-sizing wrappers, positioned icon artwork, and identity test IDs; rendered image is unchanged.            |
| `browser/images/corpus-hand-shaped-lines.dark.svg.json`  | Element count includes the natural-size title reservation and positioned title wrapper; geometry and rendered image are unchanged. |
| `browser/images/corpus-hand-shaped-lines.dark.svg.txt`   | Export DOM includes title-sizing wrappers, positioned icon artwork, and identity test IDs; rendered image is unchanged.            |
| `browser/images/corpus-hand-shaped-lines.light.svg.json` | Element count includes the natural-size title reservation and positioned title wrapper; geometry and rendered image are unchanged. |
| `browser/images/corpus-hand-shaped-lines.light.svg.txt`  | Export DOM includes title-sizing wrappers, positioned icon artwork, and identity test IDs; rendered image is unchanged.            |
| `browser/images/kafka-order-pipeline.dark.svg.json`      | Element count includes the natural-size title reservation and positioned title wrapper; geometry and rendered image are unchanged. |
| `browser/images/kafka-order-pipeline.dark.svg.txt`       | Export DOM includes title-sizing wrappers, positioned icon artwork, and identity test IDs; rendered image is unchanged.            |
| `browser/images/kafka-order-pipeline.light.svg.json`     | Element count includes the natural-size title reservation and positioned title wrapper; geometry and rendered image are unchanged. |
| `browser/images/kafka-order-pipeline.light.svg.txt`      | Export DOM includes title-sizing wrappers, positioned icon artwork, and identity test IDs; rendered image is unchanged.            |
| `browser/layout/aws-serverless-orders.json`              | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/azure-service-bus-integration.json`      | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/black-friday-commerce.json`              | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/blocking-call.json`                      | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/branch-to-datacentre.json`               | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/cell-based-bookings.json`                | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/cqrs-event-sourcing.json`                | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/delivery-dispatch.json`                  | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/ev-charging-network.json`                | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/event-driven-data-platform.json`         | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/gcp-streaming-analytics.json`            | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/hybrid-enterprise-network.json`          | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/kafka-order-pipeline.json`               | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/notification-fanout.json`                | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/observability-pipeline.json`             | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/outbox-saga-checkout.json`               | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/payments-ledger.json`                    | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/recommendations-feature-store.json`      | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/scale-on-busy-threads.json`              | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/serverless-burst-buffer.json`            | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/video-on-demand-pipeline.json`           | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/layout/webhook-ingestion.json`                  | Auto-layout/Tidy records visible, card-width-truncated titles.                                                                     |
| `browser/render/aks-app-config-key-vault.json`           | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/aws-serverless-orders.json`              | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/azure-service-bus-integration.json`      | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/blocking-call.json`                      | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/branch-to-datacentre.json`               | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/cqrs-event-sourcing.json`                | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/event-driven-data-platform.json`         | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/gcp-streaming-analytics.json`            | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/kafka-order-pipeline.json`               | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/notification-fanout.json`                | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/outbox-saga-checkout.json`               | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/scale-on-busy-threads.json`              | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/serverless-burst-buffer.json`            | Opening canvas records visible, card-width-truncated titles.                                                                       |
| `browser/render/webhook-ingestion.json`                  | Opening canvas records visible, card-width-truncated titles.                                                                       |
