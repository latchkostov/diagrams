## Shaped lines carry bends on drop

Moving both ends of a shaped line now keeps its bends fixed during the drag and carries them once
on drop, in the node move's undo step. End legs follow the moving nodes. Cancelling the bend carry
leaves the saved bends untouched. Touch release uses the existing node drag behavior.

The live preview and its new cancellation listeners are quarantined pending a gesture that can
restore both node and route transforms safely. This supersedes the live-preview and node-restore
claims in the earlier PR #280 notes. No output goldens change in this fix round.
