## Clicking beside a low-zoom connection (#378)

Each hairline keeps the natural edge's invisible hit stroke (22 diagram units, as at every zoom before this change), so a hairline is exactly as easy to click as the card-view edge was and never takes clicks from zones or cards beside it. A click just beside the line selects and focuses the connection natively: the same selection rules, context menu, keyboard shaping and endpoint reconnection, with no forwarded events or focus exceptions. As before this change, selecting something below 50% in Edit opens the focus view on it.

The regression clicks beside the line, inside that hit stroke, at 40% and 25%, returns to that zoom, and shapes the still-focused connection with ArrowDown. This change does not alter exported output or parity goldens.
