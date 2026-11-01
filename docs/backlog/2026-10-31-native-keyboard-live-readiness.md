## Palette entry requests a session before it mounts

Nightly 41245495563 retains Windows keyboard failures immediately after requesting Live. The keyboard palette driver awaited Enter alone; unlike the pointer driver, it did not await the requested session's lazy mount. Its next input could begin while the canvas and rail were still changing mode.

The Live palette command now waits for the existing session mount signal on entry, and for the editing controls on exit. A regression holds the actual LiveSession download and requires the command to remain pending, then requires the genuine picker after release. The original driver fails with `settled=true` while the download is held. No application behavior, keyboard action, timeout, tolerance, budget, skip or golden changes.

The final round-four verification fragment records targeted native and Linux repetitions and the dispatched native results. This scoped repair does not declare every remaining keyboard focus observation fixed.
