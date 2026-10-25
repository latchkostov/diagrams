## Review

The required designer-agent review found no additional chrome or contrast changes. Compact readouts keep their three rows; only explicitly pinned cards expose the full detail list. Existing controls, translations, context menus and inspector entry points are reused.

## Keyboard and ownership

The review identified two additional edge cases, both resolved: deleting a focused readout now recovers to the canvas through the interaction controller, and clicking a displayed fallback section collapses it immediately after its original section disappears. Focus ownership lives in the readout machine independently of pinning, with representative path invariants. The editor-mode machine and its focus policy remain the authority for editor interactions.

## Placement and disclosure

Position observers follow node transforms and edge rerouting without timers or extra controls. The summary model stays compact; the complete pinned model is built before ranking, and default sections are intersected with actual availability. Clipping checks inspect every required row against its own clipping region and reject an intentionally clipped fixture.

## Verification scope

Targeted browser coverage includes both read-only viewers, pointer movement during keyboard focus, hidden summaries, target deletion and Undo, malformed imported identifiers and anchor movement. Accessibility scans cover compact, problem and pinned cards in both themes. Full-suite verification belongs to PR CI for this lane.

The production browser selection passed 46 tests, including all 38 hover-card tests and eight card accessibility scans. After the final focus-recording rename and Tab simplification, 14 affected browser tests passed again. The targeted unit and startup-chunk contracts passed 232 tests; the final ownership/section selection passed 207. Deliberately reverting the fixes caused nine unit failures and five browser failures, and the clipping fixture separately rejects hidden sections. No assertions were weakened.

The four bundle gates pass with fixed budgets. Canvas first view is 374,584 gzip bytes versus 374,588 at the merge-base (four bytes smaller); entry is 107,689 bytes. Existing low startup/Live headroom is carried in a separate follow-up. The Linux five-repeat attempt with four workers/four CPUs exited 75 because the shared budget was busy; it executed no tests, so Linux load coverage is left to CI.
