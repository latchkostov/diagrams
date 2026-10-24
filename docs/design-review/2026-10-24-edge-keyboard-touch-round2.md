## Reachable reconnects and stable segment selection

No controls or chrome added. Crowded segment targets become keyboard-only so the reconnect dots
retain their complete touch hit areas. A selected leg stays selected through route normalization,
endpoint joins and lazy control remounts; cycling still chooses the next visible route leg.

Rejected raising reconnect z-index alone: segment and reconnect hit areas would still overlap.
Rejected clamping segment indices alone: an in-range index can select a different leg after rerouting.
Geometry matching uses both the perpendicular coordinate and the leg's extent along the route.

Targeted regressions cover touch hit testing, cumulative nudges and Undo/Redo, endpoint rerouting and
keyboard listener stability. Full suites and Linux load repetitions are deferred to CI under the
task's targeted-only fix-round instruction.
