## Calm zoomed-out chips

Below 60%, the editor and Live canvas use icon-and-name chips; below 30%, they tighten their spacing and type. Names wrap on whole words, then use familiar abbreviations or leading words, with the complete accessible name and app hover readout retained. At 60% and above, normal cards remain unchanged. The read-only exported viewer retains its existing renderer.

Zoom fitting runs after settle, with cached glyph widths and neighbour-bounded chip sizes. Below 60%, connections use one solid path with merged nearby lanes and subtle direction marks. Live stops particle and march painting, shows traffic through line weight, marks recent failures red and sustained queue pressure or pauses amber, and rolls trouble into each containing boundary header. Clear header bands or outside tabs keep titles off chips. No controls or diagram-format fields were added.

## Output parity

Every changed browser golden below intentionally records screen detail: complete or whole-word shortened names replace ellipses, merged single paths include their direction marks, and hidden edge-label elements are absent. Natural node positions, measured dimensions, fitted viewports, model outputs and natural-size image exports remain unchanged. The same explanation applies individually to each listed file.

Render goldens (`tests/parity/goldens/browser/render/`):

- `aws-serverless-orders.json`: settled low-zoom chip names and single-path connections.
- `azure-service-bus-integration.json`: settled low-zoom chip names and single-path connections.
- `branch-to-datacentre.json`: settled low-zoom chip names and single-path connections.
- `gcp-streaming-analytics.json`: settled low-zoom chip names and single-path connections.
- `notification-fanout.json`: settled low-zoom chip names and single-path connections.
- `outbox-saga-checkout.json`: settled low-zoom chip names and single-path connections.
- `webhook-ingestion.json`: settled low-zoom chip names and single-path connections.

Layout goldens (`tests/parity/goldens/browser/layout/`):

- `aws-serverless-orders.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `azure-service-bus-integration.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `black-friday-commerce.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `branch-to-datacentre.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `cell-based-bookings.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `cqrs-event-sourcing.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `delivery-dispatch.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `ev-charging-network.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `event-driven-data-platform.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `hybrid-enterprise-network.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `kafka-order-pipeline.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `notification-fanout.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `observability-pipeline.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `outbox-saga-checkout.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `payments-ledger.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `recommendations-feature-store.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `video-on-demand-pipeline.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.
- `webhook-ingestion.json`: chip names and single-path connections after Auto-layout/Tidy; geometry and viewport unchanged.

`tests/parity/goldens/node/i18n/catalogs.json` adds the zone-trouble message to the catalog inventory: one additional message per language, an English fallback for untranslated languages, and the corresponding Live-area hash. No export image or HTML golden is re-recorded.

## Verification

Regression coverage checks nonblank names, word-boundary shortening, icons, accessibility, complete connection counts, no chip/title overlaps, DOM reduction, settle-only fitting, capture restoration, traffic buckets, and trouble counts/recovery. Mutation checks disable abbreviation, settling and failure detection separately and require the matching regressions to fail. The three public showcase diagrams are reused without changing their saved content.
