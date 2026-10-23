## Resilience readouts with Inspector Live

Merged master into #255 with a merge commit. The Inspector's shared Live details, lazy Messages
pickers, message edge reader, label hit handling and connect-to-dot behavior remain available.
Shared hover and Inspector readouts retain settled-attempt failure rates, exclude local breaker
rejections, and preserve bidirectional text isolation. Empty sparkline histories retain master's
zero low value and docked chart presentation.

Generated skill assets were taken from master and refreshed with `pnpm regen`. The only golden
regenerated for this merge is `node/i18n/catalogs.json`: compared with this branch's prior HEAD,
17 Inspector Live messages raise each locale's message and English-fallback counts by 17 and add
the `workspaceLive` fingerprint. Compared with master, it also retains this branch's five extra
messages and corrected resilience wording. The retry policy accepts an isolated duration including
its unit. Simulation, diagram and browser goldens are not intentionally changed.

The existing bundle limits are retained: entry 107,849 / 123,500 bytes gzip, startup
173,220 / 177,000, canvas first view 382,617 / 383,000, and Live 134,798 / 135,000.
