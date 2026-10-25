## PR #312: Quarantine visible diagram-scope diagnostics

Incomplete message-loop analysis again uses master's omitted count instead of a visible finding
row. This avoids the collision between the diagnostic and an imported element named `incomplete`.
Checks retain the omitted-result summary, so uncertain cyclic or exhausted analysis is not clean.
The acyclic-timeline proof, model reasons, seed budgets/cache and search feedback remain enabled.
Visible-diagnostic tests are retained as skipped/fixme tests. MT-06/MT-12's visible-warning
requirements and all five review findings remain tracked in the
[backlog](../backlog/2026-10-25-diagram-scope-findings.md).

## Golden review against master

No remaining golden differs solely because of a visible diagnostic; none requires re-recording
for this quarantine. The ten retained PR differences have independent purposes:

- `node/agent/check/outbox-saga-checkout.json`: the acyclic proof removes the spurious omitted-loop count from agent summaries; the no-reader suggestion remains.
- `node/agent/check/payments-ledger.json`: the acyclic proof permits clean agent summaries without a spurious omitted-loop count.
- `node/agent/check/recommendations-feature-store.json`: the acyclic proof permits clean agent summaries without a spurious omitted-loop count.
- `node/checks-words/outbox-saga-checkout.json`: translated and agent summaries drop the spurious omitted-loop count; no-reader words remain.
- `node/checks-words/payments-ledger.json`: translated and agent summaries are clean because processor paths are acyclic.
- `node/checks-words/recommendations-feature-store.json`: translated and agent summaries are clean because processor paths are acyclic.
- `node/evidence/outbox-saga-checkout.json`: the evidence report drops the spurious omitted-loop count; simulation evidence remains unchanged.
- `node/evidence/payments-ledger.json`: the evidence report is clean after the acyclic proof; simulation evidence remains unchanged.
- `node/evidence/recommendations-feature-store.json`: the evidence report is clean after the acyclic proof; simulation evidence remains unchanged.
- `node/i18n/catalogs.json`: two search-result announcement keys change catalog counts, fallback counts and messageTypes hashes.

## Targeted validation

Checks unit/UI and message-types unit tests: 425 passed, 8 quarantined cases skipped.
The public-examples heavy spec: 81 passed with the repository's existing `CI=true` timeout
configuration. Its initial local run hit three 5-second timeouts (blocking-call static checks,
retry-storm evidence and blocking-call evidence); no assertion or timeout configuration changed.
Production Chromium checks-ui and message-types specs, ports 6820–6824 with two workers:
53 passed, 2 skipped (this diagnostic quarantine and the existing appended-rule quarantine).
Playwright stopped its server. No full gate or full suite was run in this quarantine round.

`node scripts/parity.mjs --tier node`: 1,858 tests passed; 3,020 goldens, 0 changed,
0 added, 0 missing, 0 stale. No golden was re-recorded. Removing the quarantine's `omitted`
marker deliberately fails the new regression (two colliding findings instead of one real
element finding); restoring it passes. Regeneration is unchanged; i18n reports zero errors
with existing translation warnings.
