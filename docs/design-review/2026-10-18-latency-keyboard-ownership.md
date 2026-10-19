## Keyboard ownership review

The existing scrollable reading surface owns native reading keys through the same target exclusion path as canvas controls. The canvas navigation controller handles node → details → next node before capture can skip the details. Reverse traversal returns to the owner. Embeds retain their local handoff.

React Flow's duplicate global Space listener is disabled: the app's existing Space-pan controller owns editing gestures and respects reading regions. The Linux Space-scroll regression checks native scrolling as well as unchanged playback; the drawing-basics tests retain Space-drag coverage.

No controls or visible copy are added. Editable Live regressions cover scrolling with a selected node, unchanged node position and playback, and forward/reverse Tab traversal. Keeping the fix in shared target classification and navigation avoids more per-key suppression handlers.
