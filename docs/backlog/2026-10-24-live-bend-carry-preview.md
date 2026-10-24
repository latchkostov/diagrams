## Live bend carry preview: quarantined after PR #280 review

Bends stay at their saved coordinates while nodes are dragged. Shared moves carry bends once,
on drag-stop, in the node move's history step. Keep this behavior until a live preview has one
cancellable gesture owning both the node transform and the route transform.

A safe preview must restore the whole gesture on cancellation, including original boundary
positions and dimensions, membership, selection, and any Alt-drag copies. In particular, cancelling
an Alt-drag of a boundary must restore the original boundary geometry as well as its members and
lines; removing copied nodes alone is insufficient.

Distinguish a normal touch release (including its implicit lost pointer capture) from a genuine
pointer cancellation. A release must commit normally, exactly once, and one Undo must restore the
nodes and bends together. Cover Escape, blur, real pointer cancellation, late moves/stops, boundary
Alt-drag cancellation, and normal touch release before enabling live preview again. Preserve
master's node drag and touch handling while this preview is quarantined.
