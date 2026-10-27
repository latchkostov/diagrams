## Readable identity in every canvas view

Presentation, link and host embeds, and the Interactive HTML viewer now share the editor's measured
title fitting and icon sizing. Narrow titles retain a meaningful prefix or initial; their tooltip and
stored name keep the full label. Camera cropping and Overview controls remain editor features.

Imported titles use cached binary search over a bounded display prefix, avoiding thousands of font
measurements for a long name.

Regression coverage checks the 10,000-character measurement bound,
presentation and read-only title fitting, and the complete delivery-dispatch node set at both zooms.

These rendering fixes leave visual goldens unchanged. Syncing with master refreshes only
`node/i18n/catalogs.json`: its message counts, fallbacks and namespace hashes include the upstream
renamed zoom-control messages and two new Live rail hints alongside this branch's camera message.

### Review rounds 2–3: floors, exports, and Overview headers deferred

- **Secondary text in every view.** Below 60% zoom, presentation, link and host embeds, and the Interactive
  HTML viewer now hide card subtitles and stencil-kind lines, as Edit and Live already did. The enlarged
  title no longer paints over them. Titles and icons are never hidden.
- **Image exports at natural size.** The capture layer itself (`suspendFrameCapture`, which the export
  path imports directly) now resets the zoom scaling for every capture. This includes PNG and SVG exports
  started from presentation, and exports made while the lazy frame-detail surface is still loading or
  failed to load. Exported images no longer depend on the current zoom. Previously, exporting at 24% gave
  titles about 40 px tall that were clipped inside their cards.
- **Overview header bands removed.** The band placement had review findings: an unbounded collision search
  and cumulative header-text measurement on imported diagrams, overlapping nested headers, and Icon-style
  titles under headers. The placement code and its tests are deleted. Overview names zones with master's
  plain focus chip at each boundary's top-left corner, and keeps the 5% zone tints, the 3:1 outlines and
  the route filtering. Header bands return later as their own PR
  (`docs/backlog/2026-10-27-overview-header-bands.md`).
- **Smaller fixes.** The card-title size has one contract: the `.nb-label` stylesheet rule, now tested
  directly. The unused title branch of `textDetail` is removed. Identity fitting skips translation-only pans,
  and the frame decoration republishes its refit signal only when the zoom or a card's measured width changes.

- **Full names without native tooltips.** Node titles no longer carry a native `title` (nodes use the app's
  tooltip), so the fitted title keeps its full name in `data-label`. Capture and unmount restore names from
  it; reading the removed attribute had blanked every exported name. Identity fitting indexes titles with
  one query and watches only the viewport's children and the root's refit attribute: an idle canvas keeps
  no whole-canvas subtree observer.

Image-export, layout and render goldens are unchanged by these rounds. One canvas golden changes on
purpose: the Interactive HTML viewer fits `branch-to-datacentre` at 54%, below the far zoom, so its 13 cards
now show icon and name without their second lines (`html/branch-to-datacentre.dark.drawn.json` text and
`.png`). This matches what Edit shows at that zoom. `kafka-order-pipeline` fits above 60% and is unchanged.
Live Overview is not in the parity corpus, so removing the header bands changes no golden.
