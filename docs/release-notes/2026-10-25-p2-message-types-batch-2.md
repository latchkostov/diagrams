## P2 message types, batch 2

MT-06, MT-07, MT-11, MT-12 and MT-13 are DONE, together with the three independent search findings from the MT-09 quarantine note. Appended-row identity remains quarantined and unchanged.

## Analysis and seed work

Incomplete analyses retain typed work-budget and timeline-forwarding reasons, including both reasons when saved runs are combined. Checks expose a warning with the applicable manual guidance rather than discarding it into an omitted count. An exhausted analysis, including an exactly-zero starting budget, cannot claim completion. Automatic message-loop fixes remain quarantined.

Traffic mixes and route identities are cached for one analysis session, with replaced setup mixes kept separate. Mix compilation is charged before allocation, unique seed expansion spends the shared budget, and duplicate inputs reuse their expansion. Operation-count regressions compare valid 8/64-route mixes and saved runs; hostile 128/1,024-row mixes are refused before compilation, and 128/1,024 unique inputs stop at the same shared cap. No clock budgets were added.

The own-property regression now gives inherited and own mappings distinct outputs. The label-cache regression changes only an implicit source label, verifies both caches update, and separately verifies an unrelated label reuses the result.

## Search behavior

Carries and Only pass say “No matches” for absent searches while retaining the existing guidance for genuinely empty populations. Clearing searches restores bounded choices without changing saved filters or traffic. Immutable vocabulary arrays retain normalized entries; broad searches collect bounded exact/substring buckets and count overflow in one pass. Empty queries preserve order without ranking. Exact-first ordering and the separate selected/offered caps remain unchanged.

## Golden changes

Nine goldens change intentionally because incomplete analysis is now a visible warning with timeline-forwarding guidance:

- `node/checks/outbox-saga-checkout.json`: adds the incomplete warning; other findings and fixes retain their behavior.
- `node/checks/payments-ledger.json`: adds the incomplete warning.
- `node/checks/recommendations-feature-store.json`: adds the incomplete warning.
- `node/checks-words/outbox-saga-checkout.json`: changes the omitted-count summary to one warning and adds its manual guidance and agent-report text.
- `node/checks-words/payments-ledger.json`: changes the omitted-count summary to one warning and adds its manual guidance and agent-report text.
- `node/checks-words/recommendations-feature-store.json`: changes the omitted-count summary to one warning and adds its manual guidance and agent-report text.
- `node/evidence/outbox-saga-checkout.json`: retains the incomplete warning in the merged findings and agent report.
- `node/evidence/payments-ledger.json`: retains the incomplete warning in the merged findings and agent report.
- `node/evidence/recommendations-feature-store.json`: retains the incomplete warning in the merged findings and agent report.

No traffic, propagation, routing, layout or rendering golden is intentionally changed.

## Verification

- Targeted Vitest: 139 passed across messageTypes, carriedTypes, messageChoices and messageLoop.
- Production Chromium message-types spec: 39 passed, 1 existing MT-09 quarantine skipped, no failures or retries. All started servers stopped.
- Mutation checks: 18 unit and 5 browser regressions killed. These include removing each reason/visible warning, restoring duplicate expansion and uncached mixes, bypassing the pre-compilation budget, processing seeds after exhaustion, removing the source-label dependency, invalidating unrelated labels, accepting inherited mappings, re-normalizing names, restoring empty-query ranking, retaining unbounded buckets, ignoring queries, introducing quadratic search work, conflating both search misses with empty flow, changing traffic while searching, and mislabelling both genuine empty states. The two initially surviving cache/allocation mutations led to stronger assertions and then failed.
- `pnpm parity checks` first reported the nine intended differences above. `pnpm parity:update checks` passed: 222 Node tests and 2 Linux browser tests; `Parity (update): 357 goldens, 9 changed, 0 added, 0 missing, 0 removed`.
- `pnpm regen` / i18n validation: 0 errors; missing/stale translation warnings retain English fallback.
- Production build and size checks passed. Entry: 107.9 kB gzip / 123.5 kB budget; viewer: 629.4 kB / 805.0 kB. Forge resource limits passed.
- Pre-commit validation uses `pnpm lint`, `pnpm typecheck` and `pnpm format:check` after the final edits.

The task's targeted-test rule applies; no full local suite or full gate was run. PR CI is the full gate. No assertions or bundle limits were loosened; no clock budgets were introduced.
