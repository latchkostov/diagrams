## Live download and short-window review

Replay downloads belong to the explicit slow-motion action. Its existing capturing/loading state
already handles the first download and retry, so removing speculative downloads requires no new
control or loading surface. Visible rail captions, full accessible names and tooltips stay intact.

In a 1280 by 540 desktop window, the taller labels put the final rail action below the frame.
Scrolling the existing rail keeps all actions reachable within its reserved space. The phone bar
retains visible overflow for its More popover. The new vertical guard catches the old layout, and
temporarily replacing full accessible names with short captions fails both new language tests.

## Rejected alternatives

Do not change benchmark budgets, warm-up cycles or goldens to hide the delayed preload. Do not
replace the rail's static React labels or add description caches: snapshots identified four
module-preload links, with no retained detached rail elements. Do not reduce label readability or
add rail controls to fit short windows.
