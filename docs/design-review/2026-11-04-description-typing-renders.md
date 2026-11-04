## Description disclosure typing review

The fix adds no controls or text and preserves the compact Inspector layout. Memoization applies only
when the disclosure's filled state and editor child are unchanged; description and locale changes
still invalidate it. A regression checks that native disclosure toggles survive unrelated edits and
typing/clearing the description. The browser typing cases explicitly open an empty Description before
editing it and retain the existing undo/redo, binding, render and commit assertions.

Inlining the hot disclosure and field wrappers preserves their DOM, classes, test IDs and accessible
names while avoiding extra component renders during description input. The shared readout stylesheet
remains an explicit dependency of the identity surface.

Keep the native disclosure and the existing render budget. Removing the disclosure would undo the
approved compaction, and increasing the budget would hide unnecessary work. No engine changes are
needed.
