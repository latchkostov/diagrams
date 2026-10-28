## Live camera and title-band CI repair (#377)

Boundary drag handles start in their reserved title band before frame decoration downloads, so
loading cannot turn a boundary drag into a canvas selection. An unnamed zone retains its full-width
drag strip. Follow keeps the chosen zoom, leaves space for a phone caller pin when revealing its
subject, and pins partially clipped secondary narration cards. Live hover details avoid the node's
painted badges as well as its body. Pins align with their remote nodes rather than a detour in the
route. Animated camera zooms counter-scale titles in CSS and search for clear bands when settled;
manual wheel zoom still updates the bands on each frame.

Tests now explicitly request close-ups where they need them, preserve the exact camera on entering
Live, and check that Overview titles occupy a clear band above their regions. The fanout tutorial's
solution explicitly focuses its router before opening the connection's properties.

No budgets or reserves change. No goldens are re-recorded for this repair. The PR's existing change
to `browser/layout/ev-charging-network.json` records the previously hidden zone title
“OT sites · outbound-only” after Auto-layout; node geometry, routes and exports remain unchanged.

## Failure classification

All 17 reported failures reproduce on PR head `12e48e3a6`. Every corresponding test passes twice
on clean master `093cfb14a`: 136 passed, zero failed, zero flaky. No reported failure is classified
as a pre-existing master flake.

Additional verification findings are recorded separately: two
[drawing-guide failures reproduced on master](../backlog/2026-10-28-drawing-guide-load-flakes.md),
and one [unreproduced evidence sweep timeout](../backlog/2026-10-28-example-evidence-load-timeout.md).
Those observations do not weaken or quarantine any test.

| Original test location                | Class    | Repair                                                                                                                  |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| workbench-council:5, phone light/dark | (a)      | Reveal leaves a caller-pin lane at the preserved zoom.                                                                  |
| workbench-followups:133, light/dark   | (a), (b) | Explicit close-up; pins retain the endpoint's direction despite route detours, with unchanged route and overlap checks. |
| followups4-inspector:61               | (b)      | Exact camera equality on entering Live and opening Properties; no automatic fits.                                       |
| followups4-inspector:99               | (b)      | Follow reveals an off-screen subject at the chosen zoom and does not reframe an already visible one.                    |
| followups4-inspector:444              | (a), (b) | Clipped secondary narration cards pin; resize preserves the incoming zoom.                                              |
| workbench-overview:10, light/dark     | (a), (b) | Titles sit above the outline and clear all parts; animated zoom avoids repeated collision searches.                     |
| zones-boundaries:915                  | (a)      | Empty drag strips retain their authored width and placement.                                                            |
| edge-node-moves:212                   | (a)      | Title-band styling and its scope exist before deferred decoration.                                                      |
| drawing-precision:164                 | (a)      | Same first-render handle repair; member movement and snapping assertions remain.                                        |
| network-devices:137, :208             | (b)      | Explicitly zoom to the firewall before inspecting its badges and event log.                                             |
| latency:106                           | (a)      | Hover placement includes painted badge obstacles.                                                                       |
| tutorials:898, fanout                 | (b)      | The solution requests router focus rather than relying on narration to choose a zoom.                                   |
| ai-layout:45, 1024px                  | (b)      | Explicitly reveal the toast's invoker; retain every overlap assertion.                                                  |
