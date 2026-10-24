## Cancel node drags and carried bends together

Escape, pointer cancellation, lost pointer capture and window blur now restore dragged nodes and their
shaped lines together, without adding an undo step. Cancelling Alt-drag removes the copied nodes and
lines. Late drag events cannot reapply cancelled movement. Interactive HTML viewers share the editor's
measurement and selection forwarding through a typed adapter. Unchanged Auto-layout is covered with
a shaped route still present. No parity goldens changed.
