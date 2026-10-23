## Click-started connections keep their replacement drag

Clicking a connection dot and then dragging from the same or another dot now keeps the new
connection active until release. Cancellation is scoped to the external capture that started
the gesture, so superseded cleanup cannot clear a new drag or release its listeners.

Foreground dialogs receive Escape before a canvas gesture. The reconnect wheel-zoom test waits
for each zoom change and its settled viewport before measuring the next endpoint.

Regression coverage checks both starting dots, continuous preview feedback, no quick-add or
document edit before release, the released source side, and foreground-dialog Escape ordering.
Both drag cases fail on master; temporarily removing capture ownership and dialog precedence
also fails the controller and browser regressions. Full parity checked all 3,111 goldens:
none changed, added, missing or stale (1,846 Node tests and 101 browser tests passed).
