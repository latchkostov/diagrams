## Typing render isolation UX review

A designer agent reviewed the change against the UX principles. There are no new controls, naming
affordances, modes or chrome. Fields still save each key, Enter/Escape finish naming, and Undo/Redo
restore the text. Locale changes invalidate translated memoized sections; diagram text stays authored.
Planning and message-field reads resume when text-field focus leaves, without recomputing on each key.

The review found two preservation requirements, both addressed: toolbar availability follows the
current history flags while retaining Undo-to-cancel during pending layout, and the selected node's
add-node chip follows measured width/height changes even when accessibility-only edge updates are
filtered out. Targeted browser regressions cover typing then Undo/Redo in all three text fields and
chip placement right → bottom → right across card growth and shrinkage. Unit coverage retains pending
layout cancellation and checks current-render history overrides. The follow-up source review approved
both remedies with no remaining UX blockers.

Rejected: delaying document updates, disabling checks to improve measurements, imperative changes to
finding buttons to hide their React renders, raising bundle limits, and changing parity goldens.
The controlled graph handoff preserves React Flow's passive publication order and existing handlers.
