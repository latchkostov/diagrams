## One Workbench dock (step 3)

Properties, Checks and AI share one resizable column, with keyboard-accessible tabs.
The dock starts closed, opens for a selection or an explicit request, and remembers
which tab to reopen. Checks returns to the preceding tab on Escape. The AI opener
and unseen-change badge stay on the tool rail. Both substantial panels remain lazy.

The default width is 372 px. The shared inspector handle changes it in 16 px keyboard
steps and remembers the preference; phone sizing remains bounded. Closing the dock
releases its width and keeps a visible, keyboard-focused reopen control.

## Compatibility and verification

All property field ids, inspector ids, checks rows and AI controls remain attached
to their jobs. `ai-rail` is removed; its tests use `ai-rail-open`. Checks-close flows
use the Properties tab or Escape. Tests that edit after selecting a finding first
switch to Properties. AI resizing uses the inspector's shared handle and step size.

Focused dock, width, focus and contrast tests pass (110). The first browser run
passed 55, failed 18 and retained one pre-existing skip. Fixes address panel stacking,
AI navigation lifetime, replacement-toggle focus and moved test flows. The follow-up
run requested fewer workers after a busy gate. No assertion or timeout was relaxed.

No goldens are re-recorded: the build spec reserves recording structural viewport
and catalog changes for step 12.
