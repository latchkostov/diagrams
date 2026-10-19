## Markdown loads when needed (PR #179)

Canvas annotations, diagram descriptions and documentation tooltips show escaped source text while
their shared Markdown renderer downloads. The canvas preloads that renderer when it has text or note
annotations; their saved positions and box sizes stay unchanged during the swap. Inspector Markdown
editing, inline annotation editing and annotation properties load when first opened. Image exports
wait for mounted Markdown views to render before measuring or cloning them, including cancellation
and document revision checks while waiting.

The benchmark's production bundle step measured canvas first-view gzip at **389,018 B before** and
**381,679 B after**, leaving **1,321 B** below the unchanged 383,000 B budget. The reported CI failure
before merging current master was 389,651 B. Build regressions keep the parser, renderer, editor and
formatting keys outside startup and the canvas's static imports, and keep editing out of the renderer.

This loading change intentionally changes no output golden. The merge of master retains its upstream
golden changes (documented in the latency/fault release fragments). Its conflicting
`node/i18n/catalogs.json` was regenerated, not hand-merged: the combined catalogue includes master's
28 new messages, raising 2,318 messages to 2,346 and updating area fingerprints and fallback counts.
For example, Arabic fallbacks rise from 302 to 330. No golden was re-recorded for lazy loading.
