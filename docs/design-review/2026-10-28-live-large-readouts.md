## Large Live readouts

Reviewed against the UX principles: no controls, chrome, terminology, camera moves or visual
states are added. Every badge remains mounted; cards approaching the pane receive their latest
state with the viewport update. Hovered and selected cards remain protected by the existing
visibility helper. Broker peak observations continue at the UI clock.

## Capture and interaction

Whole-diagram image capture disables filtering synchronously through the existing capture
lifecycle, restoring it afterwards. On-screen recording retains the current view and refreshed
entering readouts. Chips and connection pills use their existing inputs and placement. The
first-frame pan regression holds the clock so a later publication cannot repair a stale badge.

## Decision

Keep the viewport-aware badge comparison and the lazy detail preparation that funds it.
Reject unmounting, new controls, changed budgets and the ineffective hidden-badge CSS candidate.
