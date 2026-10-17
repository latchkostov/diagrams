## Follow-ups 4 review round 2 (2026-10-17)

The designer-agent review approves the camera, Retry and accessible-name changes. No production control,
menu item or ordinary Tab stop is added; the seven-control top-bar budget stays intact.

## Camera and keyboard flow

The current camera owner determines pane behavior. Entering Live replaces an earlier manual view with a
fit; a narration transition takes its focus; later keyboard zoom or pointer movement takes the camera
back. Deferred fits carry a claim so they cannot replace a newer manual command. Explicit Fit returns
to the whole diagram, including when a narration is waiting. Slow motion retains its existing policy.

Retry focuses the persistent connection status before clearing its alert. The status is programmatically
focusable, uses the existing focus ring and remains outside the normal Tab order. Both Lab fixtures have
keyboard-activation regressions that reject the old focus loss.

## Route summaries

Default now has a localized accessible name with every destination and its split; compact visual text
does not change that name. English, Arabic and the pseudo-locale browser tests cover narrow and wide
sheets. A rejecting Default keeps its existing localized implicit name.

One table batches its full-text resets, geometry reads and summary writes. Resize uses the observer's
width and skips unchanged text. The review caught a locale-change edge case: React can leave compact
DOM text in place when the authored full list has not changed. The batch restores full labels before
remeasuring, and the operation-count regression covers re-registration after compaction.

## Verification sequencing

The parity review also found Select all opening the Inspector immediately before Tidy. The helper now
waits for that pane's measurements and camera before changing the drawing. A held-ResizeObserver
regression fails when the wait is removed; this repairs the harness's sequencing without adding a
corrective Fit action or changing Tidy's behavior.

## Rejected alternatives

Keeping a historical manual flag cannot describe later automatic fits or narration ownership. Refitting
every pane change loses later manual zoom. Keeping the failure alert and active Retry visible while a new
attempt runs adds stale error chrome; moving focus to the persistent status gives a clear continuation.
Character counts and per-row measurements were rejected because actual translated text determines fit,
and the supported 256-rule table must avoid interleaved layout work.
