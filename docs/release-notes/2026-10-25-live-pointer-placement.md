## Live pointer, placement and cold keyboard details

Live skips hover-card geometry work when there is no unpinned readable card. Timeline progress
and text updates no longer re-place cards; protected-control resizes and visibility changes
still do. Breaker readouts select their displayed seconds before comparing render props, so
subsecond ticks with unchanged displayed data skip the display render.

Keyboard users can Tab into or pin node details while their code downloads. The loading stop
hands focus to the finished card only while the same request owns it. Moving focus elsewhere,
opening a menu, Escape and advancing to another node prevent a late focus steal.

Operation counts, render counts and held-chunk browser regressions cover these changes, with
deliberate mutation checks. No output goldens were changed or re-recorded. Bundle budgets
remain unchanged. No new simulation, planning or stencil feature requires another example.
