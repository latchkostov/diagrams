## Message types and example discovery follow-ups

Message pickers now defer vocabulary lowercasing until a nonempty search needs it. Empty searches
and single-select pickers keep authored names without normalization, including fresh arrays on
unrelated renders. Subsequent searches reuse the normalized vocabulary.

Eager example identities and enriched gallery records now have distinct types. Gallery search and
rendering require enrichment; startup code cannot read descriptions, thumbnails or feature tags
from identity-only records. Authored summaries and supplied local catalog details retain their fallbacks.

Regression coverage keeps the non-clean gated-cycle fallback active while visible diagram-scope
diagnostics remain quarantined. Route-specific destinations prove both positive traffic-mix routes
survive repeated seeds and cached saved runs, while the zero-rate route stays empty. Existing growth
and production work-budget tests remain intact. Deliberate mutations reject each regression.

No parity golden changes are intended or recorded. Bundle budgets and headroom floors stay fixed.

## Verification

- Targeted unit coverage: 184 passed across seven files; six existing diagnostic quarantines remain skipped.
- Bundle split and headroom contracts: 28 passed, with the existing budgets unchanged.
- Focused Node checks parity: 222 passed; 357 goldens, zero changed, added, missing or stale.
- Mutations rejected: eager normalization; pruning gated cycles; first-route-only expansion; including
  zero-rate routes; dropping a route on cached mix reuse; exposing rich fields on identities; accepting
  unenriched gallery inputs. Compiler assertions reject the last two mutations.
- Production build, entry/viewer/Forge size checks and regeneration pass. Entry gzip is 108.0 kB
  against 123.5 kB; viewer gzip is 629.5 kB against 805.0 kB. i18n reports zero errors with existing
  missing/stale translation warnings.

This fix round uses targeted tests; PR CI remains the full gate. No assertion, work budget or bundle
headroom floor was loosened, and no golden was re-recorded.
