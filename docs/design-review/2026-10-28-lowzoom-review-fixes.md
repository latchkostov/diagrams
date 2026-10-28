## Low-zoom review fixes (#378, round 1)

Low zoom keeps familiar connection interactions: offset selection, the existing context menu, keyboard shaping and endpoint dragging. Selecting a connection displays its natural route so the controls align with it. No new toolbar controls or settings were added.

Each hairline keeps the natural edge's invisible hit stroke (22 diagram units); the visible line remains a hairline. Both 40% and 25% are covered by browser interaction regressions.

Trouble summaries show only meaningful counts. Healthy zones show no pill. Failure pills use white on #a52634 (the existing Live loss-alert pair), which passes 4.5:1 in light and dark themes. Node identity, full accessible names and the existing zone-title layout remain intact. Updated real-app captures cover light and dark Edit and Live views in the original capture folder.
