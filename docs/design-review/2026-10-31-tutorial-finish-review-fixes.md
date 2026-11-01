## PR #410 review round 1

The sheet keeps its existing actions and chrome budget. Keyboard focus remains inside the visible sheet
at desktop and phone widths; closing it restores canvas interaction. The breaker preview explicitly
shows the feature becoming enabled. Annotation previews retain the authored steps without presenting
an empty board. Long settings lists scroll independently above the pinned actions.

Tooltip placement still avoids its node and instruction cards, but stationary tips perform no recurring
geometry reads. Resize, scroll, relevant DOM changes and active CSS movement invalidate placement.
Insertion semantics are queued separately as R-6cc56305b9.
