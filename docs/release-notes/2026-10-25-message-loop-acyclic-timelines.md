## Loop checks on acyclic timelines (PR #312, final fix round)

Public examples no longer show an incomplete loop-check warning solely because a saved timeline
changes message forwarding. An acyclic superset of every processor flow proves that those edits
cannot form a processor loop, including across messages already in flight. Denied, filtered,
zero-share and dead-letter connections remain in the proof graph. Possible cycles retain the
timeline warning; arriving/carried type propagation still honestly reports incomplete.

The suspected traffic-mix cap was not the cause. The three failing examples consume 2,567
(`recommendations-feature-store`), 1,615 (`payments-ledger`) and 692 (`outbox-saga-checkout`) work
units and report `timeline-forwarding`, not `work-budget`. Across all 39 public examples the
largest need is 4,128 (`black-friday-commerce`). Keep the bounded 200,000-unit budget: 48.45x
headroom already exceeds the requested 4x. A new public-example regression enforces that margin.
The PR conversation records every example's measured analysis work.

A synthetic 16-route mix exhausts the production budget with both 12,500 and 100,000 distinct
inputs; counted propagation operations stop at 662,849 for each size. Its warning remains
diagram-scoped, with no target/elements, and cannot be hidden by an element ignore. Existing
small-budget proofs and public-example findings expectations are unchanged.

The failing CI record, `browser/layout/recommendations-feature-store.json`,
differs only in Auto-layout/Tidy viewport y translation (11 px): the unintended warning adds a
22 px Checks row before fit. Removing the warning restores the intended title-card footprint;
the committed browser golden already equals origin/master and remains unchanged. Browser parity
remains for PR CI. Twelve Node goldens intentionally remove round one's spurious timeline warning:

- `node/checks/outbox-saga-checkout.json`: restore master's sole no-reader suggestion and fix results.
- `node/checks/payments-ledger.json`: restore master's empty findings.
- `node/checks/recommendations-feature-store.json`: restore master's empty findings.
- `node/checks-words/outbox-saga-checkout.json`: remove timeline warning words/reports; retain no-reader guidance.
- `node/checks-words/payments-ledger.json`: replace the warning and reports with a clean summary.
- `node/checks-words/recommendations-feature-store.json`: replace the warning and reports with a clean summary.
- `node/evidence/outbox-saga-checkout.json`: remove the warning from findings/report; simulation evidence is unchanged.
- `node/evidence/payments-ledger.json`: remove the warning from findings/report; simulation evidence is unchanged.
- `node/evidence/recommendations-feature-store.json`: remove the warning from findings/report; simulation evidence is unchanged.
- `node/agent/check/outbox-saga-checkout.json`: remove the warning and adjust all/warnings-only reports; retain no-reader guidance.
- `node/agent/check/payments-ledger.json`: return clean all/warnings-only reports without timeline warnings.
- `node/agent/check/recommendations-feature-store.json`: return clean all/warnings-only reports without timeline warnings.

Master's words, evidence and agent records described this unsupported timeline as an omitted finding, so their
clean summaries intentionally differ from master as well. No simulation output is re-recorded.
