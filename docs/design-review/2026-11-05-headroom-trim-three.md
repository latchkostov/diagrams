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

The Live, low-zoom, narration, presentation, Inspector, workbench, skill and Interactive HTML
suites passed both Linux runs: 624 passed, 22 skipped, zero failed or flaky. Both new held-renderer
cases passed in each run. Full parity retained all 3,358 goldens, with 112 browser cases passing.
The broader full gate's download-file timeout remains unclassified after a passing master replay;
see [the verification follow-up](../backlog/2026-11-05-headroom-trim-three-svg-download.md).

Post-#435 production measurements free 6,687 bytes of Live gzip and 6,947 bytes of the skill ZIP.
Canvas first view changes by six bytes with lazy-surface registration and generated chunk references, with no additional drawing
modules in its static closure. No budget, reserve, cap or visual behavior changes.
