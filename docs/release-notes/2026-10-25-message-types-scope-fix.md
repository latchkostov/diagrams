## PR #312 round 1: diagram warnings and message search

Incomplete message-path analysis is explicitly diagram-scoped. Its warning and manual guidance remain available, without Select or Ignore here actions that cannot apply to an element. Unsupported ignore attempts report that they cannot be ignored here and leave saved checks valid on reload. Diagram diagnostics cannot be hidden by an unrelated element ignore with a colliding id suffix. The shared internal omission and unchecked markers carry the same scope contract.

Only pass announces unmatched searches and returning results through a persistent polite status region. A browser regression now starts with a saved wildcard filter and more than 100 carried types, proving both searches preserve the saved filter, traffic configuration and carried population, and restore its pressed chip.

Intentional Node parity changes (ten goldens): the checks and evidence records for `outbox-saga-checkout`, `payments-ledger` and `recommendations-feature-store` each add `scope: "diagram"` to the existing incomplete-analysis diagnostic (six goldens). Their warning words, guidance and simulation evidence stay unchanged. The three corresponding `node/agent/check/` records catch up with the previous batch's intentional visible-warning change: all/warnings/simulations replies include the diagnostic and replace the omitted-count summary with the warning count. `node/i18n/catalogs.json` records the previous batch's timeline guidance plus the new matching-type count (two messages), updating messageTypes fingerprints, message counts and English fallback totals. No other output golden changes.

The suggestions-only browser fixture now uses the same public example without saved timelines, retaining its no-warning assertion while keeping the new global diagnostic visible for the unmodified example.

The remaining normalization-performance and route-deduplication coverage findings are queued in the dated backlog fragment.

## Verification

- Checks unit/UI and message-types unit tests: 383 passed across 22 files. The final focused checks rerun passed all 38 tests.
- Production Chromium checks-ui, checks-rules, checks-simulations, checks-agent and message-types: initially 68 passed, one suggestions-only fixture failed, and one existing quarantine was skipped. After correcting that fixture and adding the diagnostic reload regression, the focused rerun passed all three cases. Across these runs, 70 distinct browser tests passed and the existing quarantine stayed skipped. Intermediate JSON-loading and details-container click mistakes in the new test setup were corrected; the final test activates the actual Why summary from the keyboard and asserts visible guidance. All started servers stopped.
- Deliberately restoring the old row, ignore handler, ignore matching and picker each made its new regression fail; all fixes were restored.
- `node scripts/parity.mjs --tier node`: 3,020 goldens checked, with only the ten intentional differences described above. Targeted update passed 400 tests; its recheck reported `Parity: 670 goldens, 0 changed, 0 added, 0 missing, 0 stale`.
- `pnpm regen` refreshed committed skill assets and validated i18n with zero errors; existing missing/stale translations retain English fallback.

This fix round uses targeted verification; no full gate or full unit/E2E suite was run. Existing assertions, timing rules and bundle limits remain intact.
