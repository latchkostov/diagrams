## Filter unrelated waiting mutations (PR #320, R-b80acd92c7)

`observeProtectedControls` rescans the canvas subtree for every observed `data-waiting`
attribute mutation. Thread meters update that attribute during ordinary Live traffic even
though protected-control membership has not changed.

Restrict waiting-attribute rescans to narration notes, retaining the handling for
`data-canvas-overlay` changes. Extend the observer regression to count subtree queries
during unrelated thread-meter updates; placement counts alone miss these scans.

Deferred from the focus-ownership fix round to keep its P1 changes scoped.
