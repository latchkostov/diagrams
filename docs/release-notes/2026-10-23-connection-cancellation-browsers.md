## Connection cancellation works without TouchEvent

Cancelling a connection, including clicking a source dot and then Go live, no longer throws
in desktop browsers without a TouchEvent constructor. The existing mouseup dispatch retires
XYHandle's mouse and touch listeners and auto-pan frame, so the redundant touchend dispatch
is removed. Capture ownership from the earlier click-then-drag fix is preserved.

Regression coverage removes TouchEvent in a unit test and exercises Escape and Go live in
production-browser tests: both cases pass in Chromium, Firefox and WebKit. The unit regression
and all four Firefox/WebKit cases fail with the redundant dispatch present. Full parity checked
all 3,111 goldens: none changed, added, missing or stale. No golden is re-recorded for this fix.

The internal capture token field is named `owner`; regenerating the offline viewer with that
equivalent representation keeps the skill ZIP within its existing download budget.
