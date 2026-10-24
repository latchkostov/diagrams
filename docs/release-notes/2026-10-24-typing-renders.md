## Fewer renders while editing node text

Node label, subtitle and description edits keep unrelated canvas chrome, inspector sections and
React Flow infrastructure out of each keystroke's renders. The document still updates immediately;
Undo/Redo, naming transactions, checks, accessibility names and canvas text keep their behavior.

Measured median function-component renders / React commits per keystroke on the same workloads:

| Scenario                                                           | Before  | After  |
| ------------------------------------------------------------------ | ------- | ------ |
| Label, 1,500 nodes with a selected finding, checks held or running | 100 / 3 | 20 / 2 |
| Label, two-node Lab fixture                                        | 88 / 3  | 15 / 2 |
| Subtitle, two-node Lab fixture                                     | 85 / 2  | 12 / 2 |
| Description, two-node Lab fixture                                  | 86 / 2  | 14 / 2 |

The large checks scenario retains five renders beyond the 15-render label path: the four components
that publish the finding's stale state and disable its fix, plus the second adjacent edge's accessible
name wrapper. Those updates remain immediate. The two commits retain the controlled document's
passive handoff into React Flow. The guards now cap those paths at 20 and 15 renders respectively,
and two commits. Reverting the source fixes makes all four render guards fail at their original counts.

Profiling uses the test-installed DevTools hook, with opt-in changed-prop, hook and context diagnostics
(`TYPING_PROFILE=1`). It found recreated callbacks and inspector props rather than context churn.
No profiling code ships in the app. The Lab's **Typing and card growth** preset also demonstrates a
label widening its card and moving its add-node chip clear of the neighbouring card.

The shipped canvas first view falls from 380,992 to 380,868 gzip bytes (124 bytes smaller). No budget
is increased. Output parity is unchanged: no golden files were changed or re-recorded.
