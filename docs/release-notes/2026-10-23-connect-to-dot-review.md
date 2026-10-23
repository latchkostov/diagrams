## Dot attachment review fixes (#252)

Dropping directly on the starting dot stays rejected even when another dot lies inside the snap
radius at low zoom. Pointer feedback, the preview line and the committed attachment now use the
same resolver; hidden quick-add handles cannot replace the highlighted side or swallow the canvas
quick-add indicator. Explicit click connections retain their handle-based mouse/accessibility path.

A reconnect requires a screen-space drag before it can change a same-node attachment. Snap-radius
updates subscribe in a small component, and read-only diagrams retain their memoized document
across navigation. Browser regressions cover snap competition, no-movement and small-movement
reconnects, zero canvas-shell renders during zoom, and starting-dot retention through stencil and
shape quick-add, including naming and one-step Undo. The body-drop regression uses the standard
viewport with explicit zoom preparation.

Output parity: no goldens are changed by these fixes. No goldens were re-recorded.
