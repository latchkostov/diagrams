## Selection remains visible and actionable

The camera's reveal used the full canvas rectangle even when a sibling phone sheet covered its bottom half. Frame decoration correctly used the smaller exposed rectangle, so the selected card could become hidden and lose focus after the camera reported idle. The Windows reproduction shows Properties for Receipt subscription while only the source card remains visible.

Use the existing exposed-canvas geometry for reveals and floating-control avoidance, as Focus and Follow already do. Respect their inner frame and the card's existing badge space too: a visible body alone is insufficient if decoration clipping hides the whole card. Preserve the current zoom, selection, sheet snap, focus policy and keyboard edge-navigation rule. Add no chrome. Unit coverage includes bottom and left docks and an otherwise-visible card clipped by Focus; the real phone regression requires the selected node above Properties, focus retained and the next arrow key creating the owned edit.

A driver-only camera wait was rejected: it reproduces the hidden node and lost edit consistently instead of repairing either. The original showcase test remains unchanged.
