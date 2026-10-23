## Connection cancellation across browsers

Approved for the narrow cancellation fix. Clicking a source dot and choosing **Go live** should
finish the mode change; cancelling with Escape should return the canvas to its normal editing
state. Neither action should show the error boundary or leave a connection preview behind.
This restores the existing no-surprises and keyboard behavior contracts.

Remove the redundant synthetic touch release. The existing mouse release retires XYHandle's
mouse and touch listeners and auto-pan, so an additional constructor fallback adds a second
cleanup path without improving the interaction. Keep capture ownership checks from the earlier
click-to-drag fix so cancellation cannot release a replacement gesture.

The proposed regression coverage exercises both Escape and Go live with `TouchEvent` unavailable,
checks that the preview and quick-add are gone, and requires the live controls after the mode
switch. Run the same behavior in Firefox and WebKit as well as the normal Chromium suite.
This review inspected the code and tests; browser execution results belong in the validation
report. No new controls, wording, layout, or chrome are needed.
