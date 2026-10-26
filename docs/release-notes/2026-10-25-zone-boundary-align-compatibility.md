## Compatible arrangement and separate radius gestures

Align and Distribute again accept plain node ID arrays with the existing geometry and one-operation call contract. Tutorial alignment keeps its original arguments; explicit boundary selections retain outermost-subtree movement, with nested boundaries and members carried once in one Undo step.

Starting a radius slider drag closes the preceding keyboard transaction, so Undo restores the keyboard value before undoing that earlier edit. Browser regressions check all four computed corners at 0 and 40, after Undo and reload, and prove an empty zone label keeps its full-width, minimum-height drag target without moving enclosed nodes.

## Output parity

Regeneration and parity refresh follow the master sync. This integration fix leaves every committed golden unchanged; the existing feature goldens remain as recorded by the preceding PR fixes.

## Choices

Kept the tutorial tests and original runner contract. Rejected adapting callers to the boundary selection API and grouping keyboard changes with a subsequent pointer gesture. Full-suite verification remains with PR CI under the fix-round instruction.

## Verification

All 42 targeted Chromium tests pass, including the six arrange tutorial cases. The tutorial/editor/slider unit run passed 2,778 tests with 101 skipped and one existing backoff-budget timeout; both clean-master focused runs reproduce that timeout, documented in [the consolidated evidence](../backlog/2026-10-25-timeout-triage.md#evidence-12). A final focused arrangement and history run passed all 46 selected tests. Reverting the compatibility and gesture fixes fails four regressions; forcing fixed corners and a tiny empty handle fails all three new browser checks.

Build, bundle budgets and regeneration pass. Full-suite verification stays with PR CI.
