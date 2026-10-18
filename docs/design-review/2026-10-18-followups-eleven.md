## Follow-ups eleven UX review

The required designer-agent review inspected the diff and the injection action's source. It found
no new chrome, copy, layout or production check-scheduling change. Opening focus and boundary Tab
now use the controller's D4/D5 rows and its DOM port. Ordinary traversal stays with the browser.
Returning to the action's originating node removes an incidental context-menu cleanup race.
Native verification also caught the backdrop pointer's default focus overriding that return.
The reviewed fix cancels this default only for a press on the backdrop, before closing; inside
the form, pointer behavior stays native. It adds no independent focus writer.

The review identified two capture-harness issues: the changing readiness marker must be excluded
from sampled pixels, and visibility, marker and video cleanup need a finally block. Both are
addressed. The injection regression also covers interior Tab/Shift+Tab and all close paths.
The DOM helper is documented for this known injection form rather than as a general tabbability
implementation. No additional control or UX simplification is needed.

The agent review was static source review. Native verification passed the whole live-view spec
twice, and both Linux repetitions passed the modal regressions, including the real outside click.
The broader load run's older whole-test backstops are tracked separately from the modal behavior.
