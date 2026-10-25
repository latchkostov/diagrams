## P2 message types, batch 2 UX review

Reviewed the changed search, choice-selection and incomplete-analysis paths against
`docs/UX-PRINCIPLES.md`. This is a source review; browser regression results are recorded in the release note.

Search misses now say “No matches” in Carries and Only pass. The actual empty-flow guidance remains
for empty populations, and clearing a query restores the bounded choices. No controls or chrome were added.
The existing exact-first order, separate selected/offered limits and overflow counts remain appropriate.

Incomplete propagation becomes a visible warning with manual next steps. Timeline edits and work exhaustion
have separate reasons; automatic message-loop fixes remain quarantined. Appended-row tracking is outside this batch.

## Finding

Resolved: simultaneous timeline and budget guidance now has explicit sentence separation. No remaining UX blocker was found in the reviewed changes.
