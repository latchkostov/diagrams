## Readable identity in every canvas view

Presentation, link and host embeds, and the Interactive HTML viewer now share the editor's measured
title fitting and icon sizing. Narrow titles retain a meaningful prefix or initial; their tooltip and
stored name keep the full label. Camera cropping and Overview controls remain editor features.

Imported titles use cached binary search over a bounded display prefix, avoiding thousands of font
measurements for a long name. Overview headers truncate oversized words inside their measured width,
and skip the outside placement search when an internal header band is already clear.

Regression coverage checks the 10,000-character measurement bound, narrow headers beside other cards,
presentation and read-only title fitting, and the complete delivery-dispatch node set at both zooms.

These rendering fixes leave visual goldens unchanged. Syncing with master refreshes only
`node/i18n/catalogs.json`: its message counts, fallbacks and namespace hashes include the upstream
renamed zoom-control messages and two new Live rail hints alongside this branch's camera message.

### Review round 2: floors, exports and header placement

- **Secondary text in every view.** Below 60% zoom, presentation, link and host embeds, and the Interactive
  HTML viewer now hide card subtitles and stencil-kind lines, as Edit and Live already did. The enlarged
  title no longer paints over them. Titles and icons are never hidden.
- **Image exports at natural size.** Identity rendering now resets the zoom scaling for every capture,
  including PNG and SVG exports started from presentation. Exported images no longer depend on the current
  zoom. Previously, exporting from presentation at 24% gave titles about 40 px tall that were clipped inside
  their cards. The capture override moved from the editor-only frame decoration into identity rendering, so it
  is applied exactly once in every view.
- **Overview zone headers.** Placement now treats previously placed headers as obstacles, as well as cards. A
  tight nested zone's outside header can no longer cover its parent's header or focus button. Each zone checks
  its column in a single sweep over pre-sorted obstacles. A shared work budget (500,000 obstacle visits) bounds
  the layout for untrusted imports. Past the budget, the remaining headers sit at their zone's top edge without
  searching. Only pathological imports reach this, such as thousands of stacked boundaries.
- **Smaller fixes.** The card-title size has one contract: the `.nb-label` stylesheet rule, now tested
  directly. The unused title branch of `textDetail` is removed. Identity fitting skips translation-only pans,
  and the frame decoration republishes its refit signal only when the zoom or a card's measured width changes.

Image-export, layout and render goldens are unchanged by this round. One canvas golden changes on purpose:
the Interactive HTML viewer fits `branch-to-datacentre` at 54%, below the far zoom, so its 13 cards now show
icon and name without their second lines (`html/branch-to-datacentre.dark.drawn.json` text and `.png`). This
matches what Edit shows at that zoom. `kafka-order-pipeline` fits above 60% and is unchanged.
