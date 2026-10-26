## Zone and boundary follow-ups

Reviewed numeric Enter/blur commits and Alt-drag against the existing inspector, duplication and Undo
contracts. Equivalent numeric commits leave the document and history alone, including values clamped
to the current size. A displayed rounded value can still be committed to replace a fractional value.
No controls, wording or chrome were added.

The boundary copy regression prepares the inspector and fits the canvas before measuring the drag
handle. It checks nested members, original geometry and membership, and a single Undo/Redo cycle.
Retained the existing copy implementation; the review finding requested coverage, and the new test
confirms its behavior. Deliberate regressions in the copy ID map, nested parent references, drag follower
remapping, numeric comparison and redundant slider writes all failed the targeted assertions.
