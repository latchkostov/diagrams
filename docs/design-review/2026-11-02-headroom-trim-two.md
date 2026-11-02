## Headroom trim UX review

No controls, wording, gestures or loading surfaces change. Live's initial static graph downloads together
as before; its optional callouts, panels and exports use the existing readiness and Retry paths. CSS is
excluded from the new script grouping, preserving cursor styles and their cascade order.

The offline viewer keeps its read-only contract, including canvas keyboard focus, transient selection,
fit and zoom. Its specialized canvas port omits document commands and history while preserving the
read and camera operations used by the viewer. Unit tests compare selection and getters with the editor
and verify camera calls; existing HTML and skill viewer browser tests cover playback, focus, fit, export,
passwords, no editing, zero network requests and CSP.

The consolidated runtime also has a dedicated held-download browser test: the Live toggle retains focus
and its loading cursor, image export waits for session readiness, and a failed download uses session Retry.

Faster Live loading exposed a setup race in the frame-measurement browser test: it paused animation frames
before initial camera framing could settle. The test now waits for the camera before pausing its fake clock,
then checks it is still idle. Its zero-remeasurement assertion and spotlight positive control are unchanged.

The chrome budget is unchanged. Consolidating existing static chunks avoids a new pending panel or a new
focus handoff. Build checks continue to exclude optional readouts from first paint and keep independent
library, palette and gallery consumers free of the canvas implementation.
