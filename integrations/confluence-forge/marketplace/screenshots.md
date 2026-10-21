# Marketplace screenshots and artwork

## Required formats

Requirements checked 20 October 2026: Atlassian's [asset table](https://developer.atlassian.com/platform/marketplace/building-your-presence-on-marketplace/)
and [listing principles](https://developer.atlassian.com/platform/marketplace/marketplace-app-listing-principles/).

Use PNG, with no browser chrome, cursor, personal identity or real site address. Keep the Confluence
interface visible; captures must show the working app, rather than invented product screens.

| Asset                               | Export                                                       |
| ----------------------------------- | ------------------------------------------------------------ |
| App and partner logo                | 144 × 144 PNG; partner logo has transparent corners          |
| App banner                          | 1120 × 548 PNG (high resolution); 560 × 274 is also accepted |
| Three primary highlight screenshots | 1840 × 900 PNG each; 920 × 450 also accepted                 |
| Three highlight crops               | 580 × 330 PNG each, cropped around the feature               |
| Two gallery screenshots             | Use 1840 × 900 PNG to match the highlights                   |

Captions below are each under 220 characters. The gallery permits up to five additional screenshots
per highlight. No separate mandatory hero artwork is documented; the supplied banner fills the banner slot.

## Capture preparation

The orchestrator captures on the owner's Confluence Cloud site after the companion pilot-feedback
release is installed. Use a dedicated demo page with an invented generic order flow: Client →
Orders API → Queue → Worker. Use generic stencils and labels only, with a saved simulation that
sends traffic immediately. Use a neutral page title such as “Order flow”. Hide account menus,
avatars, site navigation details and unrelated pages. Never use private or work diagrams.

Set the capture area to the exact output dimensions; preserve readable text rather than stretching
a smaller capture. Keep controls in frame. Save shots 1–3 with both the full image and a deliberate
580 × 330 crop. Review every image for confidential content before uploading. These are capture
instructions, not a claim that real-site screenshots have already been taken.

## Five shots

| Shot / filename                                                 | Capture                                                                                                                       | Caption                                                                                                 |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1 / `highlight-play.png`, `highlight-play-crop.png`             | Published page with traffic visible just after Play; include the surrounding page heading and a short paragraph. Highlight 1. | Press Play to see messages move through the system, right beside its documentation.                     |
| 2 / `highlight-attachment.png`, `highlight-attachment-crop.png` | Macro configuration with the generic attachment selected, file input, upload and replacement actions visible. Highlight 2.    | Keep the diagram as a page attachment. Replace it when the design changes, preserving version history.  |
| 3 / `highlight-theme.png`, `highlight-theme-crop.png`           | Published page in Confluence dark theme, readable automatic height, still diagram and Play visible. Highlight 3.              | Follow Confluence's theme and keep the diagram readable alongside the page.                             |
| 4 / `gallery-simulation.png`                                    | Configuration with the saved simulation selected; show height and theme options too.                                          | Choose Free play or a saved simulation, with automatic or fixed height and a theme that fits your page. |
| 5 / `gallery-maximise.png`                                      | Forge Modal open after Maximise, showing the generic flow clearly at a larger size.                                           | Maximise the diagram for a closer look without leaving Confluence.                                      |

## Rebuild supplied artwork

From the repository root, with existing dependencies installed:

```sh
node integrations/confluence-forge/marketplace/export-artwork.mjs
```

The script uses the existing Playwright Chromium dev dependency to render `icon.svg` at 144 and
288 pixels, and `banner.svg` at both banner sizes. It starts no server and installs no dependency.
The icon retraces the connected-node mark in `public/brand/logo-256.png`, retaining its colours,
rounded background and transparent corners. The banner names the app, partner and purpose.
Only these generated PNGs and their authored SVG sources belong in this package; screenshots
come from the actual Confluence app.
