## OPEN: Diagram-scope findings after PR #312's round cap

The newly visible incomplete-analysis diagnostic is quarantined. It travels through `omitted`,
as on master, without a finding row or element actions. An omitted result still cannot report
a clean Check. The acyclic-timeline proof, typed incomplete reasons in the model, bounded and
cached seed expansion, search announcements and zero-match coverage remain enabled.

This entry supersedes the visible-warning completion claims for MT-06/MT-12 in the
[batch 2 backlog](2026-10-24-p2-message-types.md) and its
[release note](../release-notes/2026-10-25-p2-message-types-batch-2.md).

## P1 R-359ea4fc00: Finding identity collides across scopes

Repro: import a diagram containing a processor whose valid element ID is `incomplete`.
Reach it from a traffic source and give it a self-loop. Add a saved simulation with a
forwarding timeline edit. The real loop and the newly visible diagram diagnostic both get
`message-loop:incomplete`. An element ignore for that target can hide the diagram warning;
ID-keyed consumers also collide. In particular, `check_diagram` with simulations and
`rules: ['message-loop']` merges evidence through `askedWithEvidence`, which can replace the
real loop's targets and guidance with the diagnostic. ChecksCard also gets duplicate React keys.

Related OPEN P2s **R-f3c7b7fe5d** and **R-b1918517aa** describe the same identity problem
in the evidence merge and keyed UI. Source: `.reviews/20261025-012522-30449/REPORT.md`.

Suggested design: reserve a diagram-scope ID namespace that no element ID can take, validate
that restriction for imported diagrams, keep an explicit `scope` field, and provide no element
actions (selection, element chips, fixes or Ignore here) for diagram diagnostics. Review every
ID-keyed consumer together. A visible incomplete-analysis warning must never collide with an
element ignore. Before restoring these tests, prove both findings survive the evidence merge
and that ignoring the actual loop leaves the diagram warning visible, including after reload.

## MT-06 / MT-12 acceptance status

- **MT-06: OPEN for the visible guidance / never report a clean Check requirement.** Typed
  incomplete reasons remain implemented in the model; restoring visible, reason-specific
  manual guidance depends on the collision-free design above.
- **MT-12: OPEN for the visible warning / never report a clean Check requirement.** Keep the
  bounded extractor and operation-count proofs enabled. Until the warning returns safely,
  retain master's omitted count and non-clean summary for exhausted or uncertain cyclic analysis.

## Other OPEN P2s

- **R-e3f0226959: Defer vocabulary normalization until a nonempty search.** Empty-query and
  single-select pickers eagerly lowercase names; fresh node-picker arrays miss the identity cache
  on unrelated renders. Normalize lazily or share stable vocabulary indexes. Add fresh-array
  empty-query coverage proving names are never lowercased. Related earlier findings:
  R-a151abeabd / R-97a9c27cda in the [round 1 follow-ups](2026-10-25-message-types-batch-2-review.md).
- **R-6cd9846e80: Assert route-specific results in seed-deduplication tests.** The aggregate
  unfiltered `out` edge cannot distinguish expanding every positive route from only the first;
  the saved-run cache test uses only zero-rate routes. Add distinct request-filtered destinations,
  assert all positive-rate deliveries and no zero-rate deliveries, then repeat through saved runs
  sharing the cached positive mix. Related earlier finding: R-00d6efe51e in the same follow-ups.

## Retained quarantined tests

Each skipped/fixme test carries the reason
`quarantined: diagram-scope diagnostics, see docs/backlog/2026-10-25-diagram-scope-findings.md`.
Mixed model/production-budget tests keep their analysis and operation-count assertions active;
only their visible-diagnostic coverage is deferred.

- `src/checks/messageLoop.test.ts`: `keeps timeline uncertainty on processor cycles even with gated links: %j` (four cases: deny, zero share, filter, dead-letter).
- `src/checks/messageLoop.test.ts`: `keeps diagram diagnostics visible even when an element ignore has the same id suffix`.
- `src/checks/ui/ChecksCard.test.tsx`: `keeps diagram diagnostics and guidance reachable without element actions`.
- `src/checks/ui/actions.test.ts`: `rejects diagram and targetless ignores visibly and keeps saved checks valid on reload`.
- `src/model/messageTypes.test.ts`: `keeps the production-budget warning diagram-scoped` (split from the still-active production-budget proof).
- `tests/e2e/checks-ui.spec.ts`: `diagram diagnostics keep guidance and valid element ignores through reload`.
