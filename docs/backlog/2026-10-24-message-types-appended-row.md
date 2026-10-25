## MT-09 — DONE: Appended-row identity

Owner-approved on 2026-10-25. Each message rule has an internal ID. An ID-less rule's ID is derived in
memory from its incoming type and is never saved. Creating or editing a rule writes an explicit ID, and
explicit IDs round-trip verbatim ([design](../design-review/2026-10-25-rule-identity.md)). The inspector
keys its mounted controls, and the visibility of every appended row, by those IDs. This holds across
rename, Undo and Redo.

All 12 formerly skipped parameterized history cases and the quarantined browser regression
are enabled. Another 12 mounted-inspector cases use the real collaboration room adapter,
including peer moves/renames and room Undo/Redo, with 26 and 2,000 imported rules.
They cover rename → Undo → name reuse, Add A → Add B → Undo B → Redo B,
and restored appended controls remaining visible and editable without expanding the page.

See [the implementation and verification](../release-notes/2026-10-25-stable-message-rule-ids.md).

## DONE: Search misses versus empty flow (R-8dbd895066)

On a nonempty link carrying more than 100 types, a Carries search with zero matches currently says
“No messages pass with these settings”; Only pass similarly claims no types reach the link.
Show a search-specific “No matches” state and reserve empty-flow messages for genuinely empty
carried/upstream populations. Searching must preserve the diagram's traffic and saved filters.

## DONE: Avoid re-normalizing the full vocabulary (R-d6eccbe57e)

A broad query over a supported 30,000-entry filter repeatedly lowercases and ranks the full
vocabulary and allocates uncapped intermediate match arrays, including during unrelated draft
edits. Cache normalized entries and collect bounded exact/substring buckets in one pass while
counting overflow. Skip ranking for an empty query; preserve exact-first results and existing caps.
Use operation counts to bind the intended work reduction.

## DONE: Cover no-match searches (R-c565903d9b)

Add “unmatched message searches preserve traffic and report no matching types” using the existing
250-type fixture. Search both Carries and Only pass for an absent name, assert search-specific
empty states and unchanged saved filters/traffic, then clear each query and verify bounded choices
return. Also distinguish truly empty carried/upstream populations. Mutation-check the regressions.

The three search findings are completed in [batch 2](../release-notes/2026-10-25-p2-message-types-batch-2.md), with bounded cached normalization and mutation-checked unit/browser regressions. MT-09 is completed separately above.
