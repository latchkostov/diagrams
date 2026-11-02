## Palette navigation dismisses an unfinished menu

Going to a node through Ctrl+K now dismisses an open quick-add or context menu. Previously the
old menu could remain over the selected destination and keep its camera movement deferred.
This also affected going back to the already-selected node. The next keyboard command now
belongs to the destination.

The interaction controller closes the old menu before deciding the new focus move. Three controller
regressions and two real browser cases cover menu ownership, camera release and the next Alt+arrow.
No control, deadline, tolerance, budget or skip is added. No output golden is re-recorded.
