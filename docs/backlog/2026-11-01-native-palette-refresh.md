## Context publication must not reset keyboard choice

Round-six verification explicitly leaves command-refresh ownership open. `PaletteDialog` reset
its active index whenever ranking recomputed, including unchanged queries whose canvas/session
context republished. A real DOM regression moves the highlight with ArrowDown and republishes
the session: the old implementation resets to the first row without another key.

The palette now retains the highlighted command's identity across context-only refreshes, using
its current action and current index. Query and submenu changes still reset to the best result.
The regression also checks that a new query selects its best match. It passes after the fix and
fails with the reset temporarily restored. Native replay confirmation is reported separately;
this regression establishes the product bug without claiming every replay failure shares it.
