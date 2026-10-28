## Live navigation and selection

Reviewed phone and desktop Live selection, navigation and readouts. Camera
completion now also releases identity detail, so a selected service's readout is
ready at the navigation destination. No controls or chrome were added.

Kept the Edit-only gesture gates: enabling connection gestures in Live recreates
the stuck gesture regression. Selection, hover and Live actions remain available.
The regression covers body clicks and disabled-dot clicks at both widths, checks
the selected service and readout, and verifies the example remains unedited.
