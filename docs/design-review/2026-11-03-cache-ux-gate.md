## Scope and decisions

Implements findings 2–5 and 7–9 of the November 3 caching review, with finding 6's interim copy. The plain primary vocabulary applies to caching readouts only. The separate agreement work owns the compact hover summary and engine behavior. A new introductory lesson, scoped large-diagram analysis and a gallery filter taxonomy remain separate work.

No top-bar or Live-bar control was added. Empty descriptions and match/action details use native disclosures; Route table and Cache rules retain independent meanings and entry points. Cache rules remain single-open. A long Live rule list is disclosed progressively.

## Inspector measurements

Production Chromium, public Black Friday, fresh browser contexts, 1024×768 and 1280×800. Heights are Inspector body `clientHeight` / `scrollHeight`, after lazy surfaces mount. A scroll height equal to the available height means the content fits without scrolling.

| State                                      | Before at 1024 / 1280 | After at 1024 / 1280 |
| ------------------------------------------ | --------------------- | -------------------- |
| Available body                             | 663 / 695 px          | 663 / 695 px         |
| Default sections                           | 1,374 / 1,374 px      | 663 / 695 px         |
| Both rule sections open, cache rows closed | 1,374 / 1,374 px      | 1,152 / 1,152 px     |
| Product pages open                         | 2,135 / 2,135 px      | 1,676 / 1,676 px     |

Before and after screenshots, raw height measurements and actual menu counts are under `C:/Users/latch/bin/codex-tasks/cache-ux-shots/`; every captured diagram is public.

## Menu budget

All 13 caching-capable stencils were counted with Copy for AI present and an outgoing destination. Azure Front Door, Cloudflare, CDN, Fastly, Akamai, CloudFront, Bunny CDN and Google Cloud CDN decrease from 14 to 12 actions. Azure Redis, Redis, Cache, Memcached and Valkey decrease from 13 to 12. Simulation has two children on routing-capable stencils and one on plain caches. Copy has two children in Edit; optional-only regular Copy stays direct, while Copy for AI remains in the family in Live.

## Keyboard and localization

Coverage includes Shift+F10, arrow navigation into Simulation, Enter into the relevant rule editor, independent section disclosure, Rule name before policy, Edit match, row actions, existing Alt+arrows/Delete/Undo, and opening/typing/clearing an empty description without losing focus. Upgrade returns focus to the updated summary and binds its toast Undo to the history entry.

The Arabic batch covers caching controls, Expected, chips, hover facts, latency, upgrade/export and trace/lesson strings. Interpolated facts use bidi isolation, and English fallback prose has coherent direction. Diagram direction and native radio/select behavior are preserved.

## Verification

Arabic core initially exceeded the fixed 38,000-byte budget. The new route-count summary now belongs to the optional planning catalog. Gallery messages use the existing numeric lookup representation, keeping repeated English keys out of locale chunks while preserving their loading boundary and rendered text. No budget or reserve changed.

The added unit regressions fail when each corresponding implementation is temporarily restored to its original source; the restored implementation passes. The gallery and empty-description browser regressions also fail against the original production build. No assertion, budget, reserve or engine behavior was relaxed.
