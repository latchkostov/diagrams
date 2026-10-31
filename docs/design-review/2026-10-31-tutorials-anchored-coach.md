## Anchored coach: rollout UX review

The owner's chosen direction A is now the only lesson presentation. Instructions share a surface
with their target and their escape routes. The old instruction strip, dimming layer and detached
tip are removed. A target gets a quiet ring; no animation or screen dimming competes with Live.

## Chrome and actions

The progress bar keeps title, progress, Restart and Exit. Edit/Live and history retain their real
product controls in a compact workbench row. Floating those controls over the canvas was rejected:
they could obstruct a full phone dock's snap controls. Highlights moves into the coach; the help
footer keeps Hint, Show me and Do it for me together. Route buttons remain reachable when phone
words compact. Completion actions join the handoff rather than covering its next-lesson buttons.

## Placement and recovery

Placement measures the visible viewport, target, rail, dock, transport, simulation panels, menus
and popovers. It uses clear panes, a notch when adjacent, and a leader when displaced. Home
placement prefers clear space under or above the visible diagram and avoids nodes and edge labels.
Help holds still while a learner aims or tabs, as long as the target and chrome remain clear.
Legacy tips that repeat the heading give way to the actionable goal.
Coach-owned targets stay in place. There is no camera nudge: camera modes are lesson evidence.

The help reminder is a polite status after forty seconds without progress. Input, a new sub-step,
and retrying reset its timer. Hint and Show me remain optional; Do it for me and Done/Skip use the
runner's existing guarded completion machinery. No new completion shortcut or model mutation is
introduced by display routes.

## Accessibility and device review

Step announcements use the existing live region. The coach does not take focus on arrival, while
moving, or during typing; existing Retry focus also respects an active text field. Buttons retain
visible focus and native keyboard semantics. Arrow chips have translated accessible names, and
macOS Meta shortcuts use Command while literal Control+Alt navigation remains literal.

The card uses the app's existing contrast pairs in both themes. Touch controls are at least 36 px.
Placement prefers logical sides for RTL; logical spacing and wrapping accommodate the pseudo-locale.
There are no moving or pulsing decorations, including under reduced motion. Phone sheets flip and
compact before covering the target; full-dock fallback prioritizes the target and small controls.

## Scope decisions

Keep tutorial code lazy and retain every existing real-UI recipe. Reject a feature flag, camera
adjustments, simulator edits, budget increases and alternative full-screen dimming. Fix the owner's
short grow-drag spacing bug through the existing editor placement path, with direction regressions
and a real drag-and-name browser test. No new simulation or stencil showcase is needed for this
instruction presentation change.
