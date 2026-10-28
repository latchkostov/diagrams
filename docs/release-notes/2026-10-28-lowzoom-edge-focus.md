## Clicking beside a low-zoom connection (#378)

Each hairline keeps React Flow's own invisible hit stroke, sized to 22 screen pixels at any zoom. A click a few pixels beside the line selects and focuses the connection natively, exactly as at 100%: the same selection rules, context menu, keyboard shaping and endpoint reconnection, with no forwarded events or focus exceptions. As before this change, selecting something below 50% in Edit opens the focus view on it.

The regression clicks four pixels off the line at 40% and 25%, returns to that zoom, and shapes the still-focused connection with ArrowDown. This change does not alter exported output or parity goldens.
