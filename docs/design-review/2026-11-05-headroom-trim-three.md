## Headroom trim three: UX review

No controls, text, layout or styles change. The fallback renderer's pending surface renders
no chrome. Its lazy wrapper calls the interaction controller's rendered notification and uses
the same readiness registry as image export, recording and print. The worker and main-thread
paths retain the same frame loop, scene queries, options and pointer handlers.

A held fallback chunk is exercised both by forcing main-thread rendering and by failing the
worker. The tests keep a focused playback control, its pointer cursor and Tab order, then
start a real SVG export and require it to wait. The generated surface contract covers failure
and Retry without losing the session. The read-only viewer retains Live's Tab order and
annotation links while editing keys remain inert.

The full parity suite must retain every golden. Review the Live, low-zoom, narration,
presentation, Inspector, workbench, skill and Interactive HTML suites in Linux before release.

Post-#435 production measurements free 6,687 bytes of Live gzip and 6,947 bytes of the skill ZIP.
Canvas first view changes by six bytes in generated chunk references, with no additional drawing
modules in its static closure. No budget, reserve, cap or visual behavior changes.
