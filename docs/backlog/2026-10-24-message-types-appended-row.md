## MT-09 — OPEN: Appended-row identity (PR #300 quarantine)

PR #300 exhausted its two fix rounds. Review R-57aeaf8f34 in
`.reviews/20261024-213946-18231/REPORT.md` identifies lost appended-row identity across
collaboration-room projections and room Undo/Redo. The inspector retains origin/master's
appended-row tracking behavior; the WeakMap/snapshot registry is removed. This is a quarantine,
not a completed identity fix.

Any future design must pass these counterexamples with the inspector still open, bounded paging,
and appended rows visible and keyboard-editable:

- **(a) Rename, Undo, name reuse:** with more than 25 rules, append Send, rename it to Callback,
  Undo, then rename an earlier rule to Callback. The earlier row must not steal the appended row's
  identity; the restored Send row must remain visible and editable.
- **(b) Multiple appends and history:** Add A → Add B → Undo B → Redo B. Each restored appended
  row must retain its own visibility and editing controls, including A while B is undone.
- **(c) Edit together:** append beyond 25 rows, then have a peer move or rename the processor.
  Room projection deep-copies `props.emits` through `projectRecord`/`readValue`; room Undo/Redo
  also supplies projected objects. The appended rows must survive both peer edits and room history.
  Future regression coverage must exercise the room adapter rather than only local snapshots.

Object identity fails on projected copies; names fail on rename, Undo and name reuse. A stable
rule id in the model is likely needed. That changes the data model and requires an owner decision
before implementation, including persistence and collaboration/history semantics.

The 12 parameterized cases in `MessageFields.history.test.tsx` remain as skipped Vitest tests
(Vitest's equivalent of fixme). The e2e test “an appended paged rule survives rekey Undo and name reuse”
uses `test.fixme`. Their reason is
`quarantined: appended-row identity (MT-09), see docs/backlog/2026-10-24-message-types-appended-row.md`.
The original master e2e “an appended paged rule stays visible and focused after rekeying” remains
running unchanged. No tests were deleted.

## OPEN: Search misses versus empty flow (R-8dbd895066)

On a nonempty link carrying more than 100 types, a Carries search with zero matches currently says
“No messages pass with these settings”; Only pass similarly claims no types reach the link.
Show a search-specific “No matches” state and reserve empty-flow messages for genuinely empty
carried/upstream populations. Searching must preserve the diagram's traffic and saved filters.

## OPEN: Avoid re-normalizing the full vocabulary (R-d6eccbe57e)

A broad query over a supported 30,000-entry filter repeatedly lowercases and ranks the full
vocabulary and allocates uncapped intermediate match arrays, including during unrelated draft
edits. Cache normalized entries and collect bounded exact/substring buckets in one pass while
counting overflow. Skip ranking for an empty query; preserve exact-first results and existing caps.
Use operation counts to bind the intended work reduction.

## OPEN: Cover no-match searches (R-c565903d9b)

Add “unmatched message searches preserve traffic and report no matching types” using the existing
250-type fixture. Search both Carries and Only pass for an absent name, assert search-specific
empty states and unchanged saved filters/traffic, then clear each query and verify bounded choices
return. Also distinguish truly empty carried/upstream populations. Mutation-check the regressions.
