## P2 triage: Message types (2026-10-24)

Checked against `origin/master` at `7b6e905130a9`. DONE 15 / STALE 0 / OPEN 6 (deduplicated original findings;
three additional review P2s are queued in the [MT-09 quarantine](2026-10-24-message-types-appended-row.md)).

Source: the local `queued-p2-fu10.archive.md`, preserved byte-for-byte on 2026-10-24. OPEN entries retain queue review labels; closed entries name the fixing PR. Locations are current-master entry points, not the old review line numbers. Batch 1 DONE means implemented with mutation-checked regressions in this batch; the closed table retains merged-PR evidence; OPEN includes unproven historical failures. A later green run alone does not close a failure.

Each numbered batch below is an independent PR candidate of at most ten items, ordered by user impact. Keep regression assertions and current bundle limits; verify each eventual regression by temporarily reverting its fix. Refactors must preserve output parity; intentional behavior changes need reviewed golden diffs. Owner decisions remain in [the separate decision list](2026-10-24-owner-decisions.md).

## Batch 1: Picker and focused-reader usability (7 DONE, 1 OPEN)

1. **MT-01 — DONE: Restore focus after bulk-clearing an oversized filter.** `src/components/MessageTypePicker.tsx:134`. Queue: #247 last/r8.
   Pass all unmounts its own button without recording a recovery target. Return focus to a surviving chip or Add and assert keyboard focus after clearing 30,000 entries.

2. **MT-02 — DONE: Keep overflow selections individually editable.** `src/components/MessageTypePicker.tsx:50`. Queue: #247 last.
   Only the first 100 selections render; the rest can only be cleared together. Add bounded paging or search for selected values and retain per-type removal and focus.

3. **MT-03 — DONE: Reveal omitted carried types on demand.** `src/canvas/inspector/MessageFields.tsx:49`. Queue: #264.
   The bounded Carries list only reports a count, hiding the actual names. Add a bounded disclosure/search that works from the keyboard without rendering the entire vocabulary.

4. **MT-04 — DONE: Let message-card Escape precede canvas selection shortcuts.** `src/canvas/edges/MessageTypesCard.tsx:7`. Queue: #247 r8.
   The card's tooltip listener loses to the window-capture canvas shortcut. Register it with the controller Escape stack and verify one Escape closes the card while preserving selection.

5. **MT-05 — DONE: Wrap long message names in focused-edge cards.** `src/canvas/edges/MessageTypesCard.tsx:24`. Queue: #247 r8.
   The inherited card style does not establish readable wrapping for hostile long names. Bound width, wrap arbitrary tokens and test a keyboard-focused edge at a short viewport.

6. **MT-08 — DONE: Scope the message reader to its own canvas.** `src/canvas/edges/EdgeMessages.tsx:64`. Queue: #264.
   Lab hosts install document-wide pointer/focus listeners and queries. Resolve within the owning React Flow root and test two canvases with overlapping edge IDs.

7. **MT-09 — OPEN: Keep an appended rule visible after rekey Undo.** `tests/e2e/message-types.spec.ts`. Queue: #247 last.
   Quarantined after PR #300's round cap: object identity fails across room projections and room Undo/Redo;
   names fail on reuse after Undo. Master's tracking behavior is restored and identity-only regressions are
   retained as fixme/skipped tests. See [counterexamples and required owner decision](2026-10-24-message-types-appended-row.md).

8. **MT-10 — DONE: Incomplete bulk Emits drafts preserve saved values.** `tests/e2e/message-types.spec.ts:681`. Queue: #247 final.
   The textarea coverage needs explicit incomplete/invalid intermediate drafts. Assert the existing maps remain unchanged until parsing succeeds, then one Undo restores them.

Batch 1 implementation and mutation evidence: [release note](../release-notes/2026-10-24-p2-message-types-batch-1.md). The picker and Carries search keep their rendering caps; card Escape belongs to the interaction controller; the reader stays within its owning React Flow root. MT-09's rekey Undo identity work is quarantined; see the [quarantine note](../release-notes/2026-10-24-message-types-appended-row-quarantine.md). Bulk Emits needed stronger tests, with no parser behavior change.

## Batch 2: Analysis reasons, seed budget and binding regressions (5 OPEN)

1. **MT-06 — OPEN: Preserve why type analysis is incomplete.** `src/model/messageTypes.ts:53`. Queue: #247 quarantine.
   Unsupported forwarding timeline edits and work exhaustion share one incomplete result/message. Return a typed reason and distinct manual guidance without weakening quarantine.

2. **MT-07 — OPEN: Budget and cache traffic-mix seed expansion.** `src/model/messageTypes.ts:106`. Queue: #247 r8.
   Repeated scenarios can expand large route/type mixes before propagation's work cap. Charge unique seed expansion to the shared budget and cache immutable mixes; add operation-count and hostile-input tests.

3. **MT-11 — OPEN: Make own-property coverage distinguish wildcard bugs.** `src/model/messageTypes.test.ts:160`. Queue: #247 r8.
   A fixture that yields the same output under incorrect inherited wildcard handling is not binding. Give inherited and own keys different outputs and mutation-check the lookup guard.

4. **MT-12 — OPEN: Exhausted propagation cannot report a clean Check.** `src/model/messageTypes.test.ts:398`. Queue: #247 r8.
   A bounded extractor result alone does not pin the user-facing warning. Run Checks on an exhausted graph and assert explicit incomplete guidance with no false clean result.

5. **MT-13 — OPEN: Isolate source-label cache invalidation.** `src/canvas/edges/carriedTypes.test.ts:67`. Queue: #261.
   Changing multiple fields lets another invalidation hide a missing label dependency. Change only the source label and assert carried types update while unrelated labels reuse the cache.

## Closed or superseded findings

| ID    | Status | Finding and current evidence                                                                                                                                                                                       | Fixing PR / reason                                       |
| ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| MT-14 | DONE   | **Bound loop extraction and move propagation out of render** — `src/model/messageTypes.ts:60`. The bounded extraction/cache PR replaces unbounded render work; later #264 keeps unique finding-element accounting. | [#261](https://github.com/latchkostov/diagrams/pull/261) |
| MT-15 | DONE   | **Bound inspector Carries rendering** — `src/canvas/inspector/MessageFields.tsx:40`. The inspector renders at most MAX_CHOICES chips; the separate on-demand overflow accessibility gap remains OPEN.              | [#264](https://github.com/latchkostov/diagrams/pull/264) |
| MT-16 | DONE   | **Invalidate translated hover text when language changes** — `src/canvas/edges/carriedTypes.ts:11`. The carried-types reader observes language changes instead of reusing old translated overflow text.            | [#264](https://github.com/latchkostov/diagrams/pull/264) |
| MT-17 | DONE   | **Preserve highlighted type during deferred propagation** — `tests/e2e/message-types.spec.ts:28`. The picker uses stable identity and the browser test updates choices while it remains open.                      | [#264](https://github.com/latchkostov/diagrams/pull/264) |
| MT-18 | DONE   | **Mount the extracted edge reader in both Lab hosts** — `tests/e2e/message-types.spec.ts:16`. Both Lab fixtures exercise hover and keyboard focus; canvas ownership remains a separate OPEN issue.                 | [#264](https://github.com/latchkostov/diagrams/pull/264) |
| MT-19 | DONE   | **Remove eager verification-graph collection from Checks** — `src/checks/rules/messageLoop.ts:29`. Checks use bounded ordinary extraction without collecting quarantined fixer verification graphs.                | [#264](https://github.com/latchkostov/diagrams/pull/264) |
| MT-20 | DONE   | **Manual message-loop guidance is revealable** — `tests/e2e/message-types.spec.ts:152`. The browser test opens the finding and pins manual guidance with no automatic fix.                                         | [#247](https://github.com/latchkostov/diagrams/pull/247) |
| MT-21 | DONE   | **Budget unique finding elements** — `src/checks/rules/messageLoop.ts:18`. loopElements deduplicates element IDs before charging copied output, rather than counting repeated traversal occurrences.               | [#264](https://github.com/latchkostov/diagrams/pull/264) |

## Scope and verification

This is a documentation triage, not an implementation or a new reproduction run. Before taking a batch, recheck its OPEN entries against the then-current master, run the named regression family, and retain any reduced fixture or trace. Tests/CI batches may take separate runner investigations; stop at the bounded evidence step rather than weakening assertions. No application code or output golden changes belong to this triage.
