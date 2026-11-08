## Canvas frame UX review

Reviewed against the UX principles with the required designer agent. No new controls, menu entries,
Inspector rows, labels or translations are added. Diagram direction is unchanged; caption measurements
use rendered geometry rather than assuming a text direction.

Stroke, halo and pointer geometry now agree. Complete lanes also supply pointer and keyboard editing
geometry. The review caught the risk of saving a temporary pin detour as authored waypoints: that behavior
is withheld, existing pin editing is preserved, and T05.02 records the explicit owner decision still needed.

The review also identified solid annotation/header collision blockers and dependency-popover anchoring.
Enlarged captions now query the settled obstacle index, and popovers use displayed caption bounds.
Captions hide when their readable size has no clear home and return when room opens. Card/note obstruction
regressions cover style restoration; capture tests cover both clearing and restoring the effective route.

The final review caught an off-screen optimization skipping enlargement before Focus moved a caption back
into view. Cropped frames now measure those candidates too. Its regression fails when the optimization
is restored; Custom and Overview still skip off-screen enlargement and retain the existing read bound.

The existing layout-read and operation-count bounds remain unchanged. Off-screen captions skip unnecessary
enlargement measurements; traffic-only changes still avoid a complete frame pass.

The browser benchmark gate caught a subscription regression: every edge re-rendered when the frame model
changed (pan totals 11.2/44.8 against 10; selection 408.5 against 250). Path painting remains one imperative
frame batch, while selected controls, open popovers and deny markers observe geometry changes. Inactive
selectors keep the natural route identity, with a mutation-checked regression. Budgets remain unchanged.
