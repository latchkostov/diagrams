## Workbench council corrections

The visible frame now contains whole cards, with a reserved Requests/React Flow row above narration and transport. Retained neighbours use named pins and shortened connections; unretained connections fade without arrows or labels. Pins clear the card bodies, and dependency glyphs do not survive alone at the frame edge. Particles sit below edge-label pills. Dark boundary washes carry the same quiet weight as light ones.

Processed badges use neutral ink. Red badges now explicitly say **Lost**. Runtime inspection corrected one council assumption: Checkout's 1.7k is its terminal `dropped` count; the dock's “1.7k processed · 21 lost” belongs to Payments. Keeping actual losses labelled avoids presenting them as healthy throughput. Kept/in-flight/fleet annotations share the pale, glyph-led vocabulary, and Overview omits oversized raw counts.

Phone Follow leaves a visible incoming segment with particles and a timeout/retry annotation. The note scrim follows the highlighted card's rounded outline without a rectangular margin; off-frame badges disappear. Read note, Earlier and Later have 44 px targets. The orphan follow dot is removed.

Overview keeps stronger silhouettes and principal connections, drops tiny icon tiles and blank annotation rectangles, and retains zone focus labels. The dock's attention pill has room for its chevron, the unavailable-throughput note has a 16 px inset and information glyph, and the Description hint wraps. Dock pointer resizing now survives changes to the adjacent drawing column, and the handle remains reachable above sticky headings. Resize tests use the documented 372 px default and retain their original drag-distance/geometry thresholds. Inspector scrolling starts at a section heading; a single selected subset is labelled Focus. The zoom separator is removed. Check badges sit inside cards, with clear spacing, and connector warnings move away from their corner.

## Review and verification

All 18 production-build shots were recaptured at the original 1440×900 / 390×844 viewports, using the same three public examples, into `C:/Users/latch/bin/codex-tasks/redesign-2026-10/build/final-2/`. Both themes were reviewed as captured PNGs.

PNG sampling: loss badges 7.18:1 in both desktop themes; neutral kept count 15.30:1 light / 13.02:1 dark; narration time 5.78:1 / 6.78:1; Following 5.45:1 / 6.62:1; throughput note 5.30:1 / 6.43:1. Browser regressions retain the 3:1 connection and 4.5:1 text floors. Badge-class and fit-rectangle mutations each fail their targeted unit regression. Budgets and the 835,000-byte ZIP cap are unchanged.

## Every changed golden

Only the following 26 browser records differ from the pre-fix build. No node geometry, authored routes, simulation, planning, i18n or model golden changes. Screen paths end at pins while authored route paths remain intact. The generated viewer is refreshed without a plugin version change. Edit annotations and boundary labels remain available; only blank Live Overview notes are omitted.

| Golden                                              | Reason                                                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `browser/images/branch-to-datacentre.dark.png`      | Overview connection opacity increases from 0.35 to 0.7; exported paint follows that visibility correction.                        |
| `browser/images/branch-to-datacentre.dark.svg.txt`  | Overview connection opacity increases from 0.35 to 0.7; exported paint follows that visibility correction.                        |
| `browser/images/branch-to-datacentre.light.png`     | Overview connection opacity increases from 0.35 to 0.7; exported paint follows that visibility correction.                        |
| `browser/images/branch-to-datacentre.light.svg.txt` | Overview connection opacity increases from 0.35 to 0.7; exported paint follows that visibility correction.                        |
| `browser/layout/aws-serverless-orders.json`         | whole-card culling and unretained label suppression in Focus; retained edge labels placed in free space inside the visible frame. |
| `browser/layout/azure-service-bus-integration.json` | whole-card culling and unretained label suppression in Focus.                                                                     |
| `browser/layout/black-friday-commerce.json`         | whole-card culling and unretained label suppression in Focus; retained edge labels placed in free space inside the visible frame. |
| `browser/layout/branch-to-datacentre.json`          | fit reflects the smaller zoom cluster after removing its stray separator.                                                         |
| `browser/layout/cell-based-bookings.json`           | retained edge labels placed in free space inside the visible frame.                                                               |
| `browser/layout/delivery-dispatch.json`             | whole-card culling and unretained label suppression in Focus; retained edge labels placed in free space inside the visible frame. |
| `browser/layout/ev-charging-network.json`           | whole-card culling and unretained label suppression in Focus; retained edge labels placed in free space inside the visible frame. |
| `browser/layout/event-driven-data-platform.json`    | whole-card culling and unretained label suppression in Focus; retained edge labels placed in free space inside the visible frame. |
| `browser/layout/measured-order-capacity.json`       | fit reflects the smaller zoom cluster after removing its stray separator.                                                         |
| `browser/layout/observability-pipeline.json`        | whole-card culling and unretained label suppression in Focus; retained edge labels placed in free space inside the visible frame. |
| `browser/layout/outbox-saga-checkout.json`          | whole-card culling and unretained label suppression in Focus; retained edge labels placed in free space inside the visible frame. |
| `browser/layout/recommendations-feature-store.json` | whole-card culling and unretained label suppression in Focus; retained edge labels placed in free space inside the visible frame. |
| `browser/layout/video-on-demand-pipeline.json`      | retained edge labels placed in free space inside the visible frame.                                                               |
| `browser/render/black-friday-commerce.json`         | whole-card culling and unretained label suppression in Focus.                                                                     |
| `browser/render/cell-based-bookings.json`           | whole-card culling and unretained label suppression in Focus; retained edge labels placed in free space inside the visible frame. |
| `browser/render/contoso-dmz.json`                   | fit reflects the smaller zoom cluster after removing its stray separator.                                                         |
| `browser/render/delivery-dispatch.json`             | whole-card culling and unretained label suppression in Focus.                                                                     |
| `browser/render/ev-charging-network.json`           | whole-card culling and unretained label suppression in Focus.                                                                     |
| `browser/render/hybrid-enterprise-network.json`     | whole-card culling and unretained label suppression in Focus.                                                                     |
| `browser/render/measured-order-capacity.json`       | fit reflects the smaller zoom cluster after removing its stray separator.                                                         |
| `browser/render/recommendations-feature-store.json` | whole-card culling and unretained label suppression in Focus.                                                                     |
| `browser/render/video-on-demand-pipeline.json`      | whole-card culling and unretained label suppression in Focus.                                                                     |
