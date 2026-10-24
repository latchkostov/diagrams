## Bundle headroom follow-up

The edge-shaping bundle comparison reports startup and canvas-first-view headroom below the 8,192-byte
warning floor. Keep the fixed budgets. A dedicated trim PR should recover headroom, owned by the next
bundle-maintenance change; pointer shaping itself loads on selection and does not justify a budget increase.

## Automatic non-orthogonal line shaping

The default orthogonal lines and saved shaped routes support segment dragging. Automatic diagonal
Straight lines and sampled Bezier curves have no orthogonal segment to grab, so they do not expose
invalid handles. A later design should define a visible conversion gesture before offering orthogonal
shaping for these automatic styles; silently freezing a curve into a staircase was rejected.
