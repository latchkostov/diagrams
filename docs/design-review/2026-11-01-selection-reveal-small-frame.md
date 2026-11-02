## Prefer visible selections over breathing room

The reveal frame must distinguish optional margins from the space needed by card
decorations. A selection that fits the safe Focus or Follow frame uses that frame
on an axis when the preferred margins leave too little room. A genuinely oversized
selection keeps its established centring behavior. Overlay avoidance uses the same
safe frame, so it cannot trade a covered card for one clipped by the dock or frame.

The regression with floating controls first verifies intersection after the plain
reveal, then requires an additional avoidance pan, no remaining intersection,
unchanged zoom, all four decorated edges inside the frame and an idle second
reveal. Both new regressions fail with the geometry fix reverted. There are no
new controls, copy, layout settings or changes to keyboard navigation policy.
