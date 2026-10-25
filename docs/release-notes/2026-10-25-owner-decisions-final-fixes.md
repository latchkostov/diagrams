## Owner decisions: final CI fixes

Live node double-click opens Properties without focusing or selecting the name. F2, Enter,
menu Rename, command-palette Rename and quick-add still select the whole name. Naming tests
now explicitly request naming before checking its Escape, Enter and saved-simulation behavior.

The inline rate-limit example is included in simulation-count, gallery-theme and rate-limit
filter expectations. Its Free play lesson has no saved presentations. The new routing snapshot
records only its two straight horizontal connections (partner to limiter, limiter to API);
existing routing snapshots remain unchanged. These fixes leave Node output unchanged.
Syncing master regenerated only `node/i18n/catalogs.json` to combine the upstream tutorial
copy with this branch: 20 more messages per locale, the corresponding English fallbacks and
updated tutorial-area hashes. No other Node golden changed during sync.

A controlled-clock browser regression edits Rate limit during running Live traffic, checks
reduced downstream throughput, invalid input retention, Undo recovery and clearing the cap.
The room retry flake ledger retains its entry under the current test title.
