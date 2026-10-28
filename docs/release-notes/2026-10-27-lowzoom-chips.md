## Calm zoomed-out chips

Below 60%, the editor and Live canvas use icon-and-name chips; below 30%, they tighten their spacing and type. Names wrap on whole words, then use familiar abbreviations or leading words, with the complete accessible name and app hover readout retained. At 60% and above, normal cards remain unchanged. Presentation, embeds and the read-only exported viewer keep their existing renderer, and slow motion replays over the natural drawing at any zoom.

Zoom fitting runs after settle, with cached glyph widths and neighbour-bounded chip sizes. Below 60%, connections use one solid path with merged nearby lanes and subtle direction marks. Live stops particle and march painting, shows traffic through line weight, marks recent failures red and sustained queue pressure or pauses amber, and rolls trouble into each containing boundary header. Clear header bands or outside tabs keep titles off chips. No controls or diagram-format fields were added.

## Output parity

No browser golden changes. Chips are screen-only: they never change a measured card, a route, Auto-layout, Tidy, a fitted viewport or an export, so the browser tier keeps pinning the natural drawing at every fitted zoom (it sets the `diagrams.lowZoom` storage key to `off`; docs/PARITY.md, Browser tier). `tests/e2e/lowzoom-chips.spec.ts` checks that image exports at 40%, 25% and back at 100% match the natural drawing, and `tests/e2e/lowzoom-*.spec.ts` cover the chips themselves.

`tests/parity/goldens/node/i18n/catalogs.json` adds the zone-trouble messages to the catalog inventory: one additional message per language, an English fallback for untranslated languages, and the corresponding Live-area hash.

## Verification

Regression coverage checks nonblank names, word-boundary shortening, icons, accessibility, complete connection counts, no chip/title overlaps, DOM reduction, settle-only fitting, capture restoration, traffic buckets, and trouble counts/recovery. Mutation checks disable abbreviation, settling and failure detection separately and require the matching regressions to fail. The three public showcase diagrams are reused without changing their saved content.
