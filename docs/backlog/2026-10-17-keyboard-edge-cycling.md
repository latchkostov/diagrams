## Edge cycling before deferred focus

The native macOS artifact from Nightly 39067118379 repeats “Outgoing 1 of 2” on the next
Ctrl+Alt+] instead of advancing to the second edge (`structure-bulk.spec.ts`).
`CanvasView.tsx` announces an edge selection before its animation-frame callback focuses it;
edge cycling reads the focused edge, so another key before that callback can choose the first
edge again. The sequential workflow test now waits for the focus it is meant to act from.

## Follow-up

Track the pending edge destination as well as the pending node destination, and add a regression
dispatching both navigation keys before the focus frame. This requires `src/canvas/CanvasView.tsx`,
which the slow-machine task was explicitly instructed to leave to the parallel canvas refactor.
No protected canvas source or stylesheet is changed here.
