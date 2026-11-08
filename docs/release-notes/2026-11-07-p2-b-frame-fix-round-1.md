## Settled canvas captions and packed fan coverage

Caption placement indexes the settled cards, badges and pins once, adds accepted captions incrementally,
and queries only the envelope containing each route's candidate positions. Low-zoom edits and settled
pan/zoom no longer copy and scan the entire blocker list for every visible caption. Placement rules and
exported geometry are unchanged. Parity compared 3,377 goldens: 0 changed, added, missing or stale.

The mixed dependency, Message and Request browser regression now requires frame packing, checks all
three pairwise screen-space lane gaps, preserves both endpoints, and verifies that an obstruction rejects
packing. Strokes, halos and pointer targets share the accepted and rejected routes. The Lab includes the
packed fan and the synthetic caption-grid benchmark.

Local report-only Chromium benchmark: 1,500 nodes / 750 labelled edges, 1440 x 900, CPU throttle 2,
five samples per scenario on production E2E builds. Median main-thread task CPU (including settlement):

| Scenario | Before (ms) | Indexed lookup (ms) | Final code (ms) |
| -------- | ----------: | ------------------: | --------------: |
| Pan      |      121.16 |              111.84 |          132.82 |
| Zoom     |    1,028.70 |            1,082.02 |        1,078.03 |
| Edit     |      251.60 |              219.44 |          229.80 |

The final-code repeat also asserts that enlarged captions are active. These local timings vary:
the final run is +9.6% for pan, +4.8% for zoom and -8.7% for edits versus the baseline. They are
report-only measurements, not evidence of a pan/zoom speedup. The deterministic operation regression
covers an eightfold input increase and fails with the old whole-blocker scan (43.06x work, above the
24x limit). Restoring the indexed query passes.

Bypassing frame packing deliberately fails the new browser separation assertion. The restored code
passes 57 affected unit tests and 140 Linux build-target E2E results (three related specs, five repeats,
six workers), with zero failures or flakes. Placement rules, tolerances and goldens were retained.
