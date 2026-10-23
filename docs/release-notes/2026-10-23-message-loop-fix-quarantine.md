## Conservative message-loop Checks

Message-loop warnings now give manual guidance without automatic filter or rename fixes; saved
simulations with forwarding property edits in their timeline are marked incompletely analyzed.
See [the follow-up](../backlog/2026-10-23-message-loop-fix-quarantine.md) for both repros and requirements.

Tests intentionally changed from offered fixes to withheld/manual results cover saved-only traffic,
saved setup overrides, all filter/rename variants, playback configuration, shared request routes,
large batches/selected fix targets, the ordinary callback, rename alternatives and non-loop branches
(`src/checks/messageLoop.test.ts`), manual filter history (`src/checks/fixes.test.ts`), rejection of
cached filter/rename and selected-loop actions (`src/checks/ui/actions.test.ts`), plus the callback Check browser test
(`tests/e2e/message-types.spec.ts`). Manual delivery/playback assertions remain covered.

Twelve message-loop output goldens change, only in completeness reporting: Checks now report one
omitted message-loop finding instead of implying the timeline was fully analyzed, and agent descriptions
mark message-type analysis incomplete. Existing findings and simulation counters are unchanged:

- `node/checks-words/outbox-saga-checkout.json`
- `node/checks-words/payments-ledger.json`
- `node/checks-words/recommendations-feature-store.json`
- `node/evidence/outbox-saga-checkout.json`
- `node/evidence/payments-ledger.json`
- `node/evidence/recommendations-feature-store.json`
- `node/agent/check/outbox-saga-checkout.json`
- `node/agent/check/payments-ledger.json`
- `node/agent/check/recommendations-feature-store.json`
- `node/agent/describe/outbox-saga-checkout.json`
- `node/agent/describe/payments-ledger.json`
- `node/agent/describe/recommendations-feature-store.json`

The checks-words records update the panel/agent summary variants; the evidence records update their
agent report summary. The agent/check records update the full, warnings-only and simulation report
summaries. The agent/describe records set `messageTypesComplete` to false and add the existing incomplete
propagation notice to both full and focused text descriptions. No simulation, export, layout or browser-render golden changes are intended.
