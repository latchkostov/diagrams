## Keep the optimized E2E run deterministic

The first container run exposed two test setup weaknesses. The save-destination
test now fits the reopened drawing before clicking a node that can be behind the
stencil rail. The frozen-clock checks-typing probe waits for completion messages
instead of accumulating wall-clock polling delays between its measurements.

All 21 measurement pairs, render and worker assertions, and the existing test
timeout are preserved. Real-CPU measurements keep their existing probe. No
application behavior or output goldens change.
