## Smaller skill download (2026-10-22)

The downloadable skill ZIP shrinks from **834,580 B to 806,125 B**, saving **28,455 B**
and leaving **28,875 B** below the unchanged **835,000 B** cap. All 15 archive entries
unpack to exactly the same bytes. No feature, icon, stencil, locale or reference content changes.

The table measures Windows on Node 24.22.0. The Linux parity build measures **834,580 B
to 806,127 B**, saving **28,453 B** with **28,873 B** of headroom. Its existing CSS
minifier rounds one color component differently, which also changes the style's CSP hash;
both builds pass their output checks without changing a golden.

The packager compares a five-iteration Zopfli DEFLATE stream with its existing zlib
candidates and keeps the smallest per entry. This uses the same standard ZIP method 8;
ordinary unzip tools need no additional decoder. The pinned WebAssembly compressor is a
build dependency and is absent from the app, HTML viewer and downloaded skill.

| Compression change     |  Before (B) |   After (B) |  Saved (B) | Identity check                                                                  |
| ---------------------- | ----------: | ----------: | ---------: | ------------------------------------------------------------------------------- |
| Viewer template entry  |     611,218 |     590,825 |     20,393 | Inflated bytes equal the original HTML, including fonts, JS, CSS and CSP hashes |
| Icon catalog entry     |     132,684 |     127,648 |      5,036 | Inflated JSON and every SVG are byte-identical                                  |
| App module entry       |      36,897 |      35,580 |      1,317 | Inflated JavaScript is byte-identical                                           |
| Check module entry     |       7,787 |       7,523 |        264 | Inflated JavaScript is byte-identical                                           |
| Spec entry             |      13,360 |      12,547 |        813 | Inflated JSON is byte-identical                                                 |
| Remaining ten entries  |      30,460 |      29,828 |        632 | Every inflated file is byte-identical                                           |
| **Total entry bodies** | **832,406** | **803,951** | **28,455** | Archive names, order, CRCs and uncompressed sizes are unchanged                 |

No parity golden changes, including `node/skill/files.json`: skill payloads are unchanged.
Both parity tiers must pass against the existing goldens. The regression compares against
the previous compressor in the same run and requires at least 15,000 B of savings; the
existing download cap stays fixed. Removing the Zopfli candidate makes this assertion fail
with zero bytes saved.

The viewer already embeds one Latin WOFF2 variable font per family. Further subsetting
would restrict authored text. Extra Oxc minification saved 129 B on app code and nothing on
the viewer; a second Terser pass saved only 354 B gzip on the viewer. Neither justified a
new transformation. Font coverage, SVG geometry and all generated viewer/skill content stay
unchanged. A measured complete compression pass takes about four seconds locally; this is
paid when building the ZIP, and the dev server retains its existing per-change ZIP cache.
