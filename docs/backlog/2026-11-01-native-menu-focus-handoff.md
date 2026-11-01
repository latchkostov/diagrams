## An open menu cannot acknowledge focus with interaction idle

Round-six macOS api-gateway stops inside the keyboard driver's `focus` helper with the canvas
still `menu-open`. The requested quick-add search has mounted while focus is still on its canvas
node. The driver's next action waits for interaction idle before sending Tab, but the menu stays
open after taking focus, so that wait cannot finish.

The driver now waits for the real focus transition when a menu has opened over the focused node,
then rechecks its requested control before sending another key. Canvas navigation still awaits
interaction idle and camera idle. No camera rule, key, assertion deadline or tolerance changes.

A production-browser regression holds the real quick-add search's focus calls, starts the driver,
then releases the handoff while the menu remains open. The old driver fails with the same idle
wait; the repair passes three Windows repetitions. The scoped reversion and Linux repetitions
are recorded in the round-seven verification. Native macOS confirmation remains separate.

The final fixture observes the driver's canvas-read request before releasing focus. An experimental
DOM attribute-read marker was invisible to Playwright's isolated-world reader and failed all three
runs at that fixture marker; it was removed. The corrected fixture passes three repetitions and
fails again with the idle wait temporarily restored.
