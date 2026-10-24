## PR #280 quarantine UX review

Keep saved bends visible while dragging and carry them on drop, together with the node move's
Undo. This adds no controls or chrome. Moving one end still keeps bends absolute; end legs can
follow the node. Normal touch release keeps the established node drag behavior.

Reject another cancellation lifecycle patch in this round. A future live preview must own both
transforms and restore complete boundary geometry, including Alt-drag cancellation, while
distinguishing touch release from cancellation. Track that work in the dedicated backlog fragment.
