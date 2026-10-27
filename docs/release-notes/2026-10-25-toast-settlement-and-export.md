## Complete drag Undo and accessible export cancellation

A drag that moves a node and an inner boundary out of their parent now finishes both membership
settlements before its notification captures history. Its Undo restores the entire drop in one step.

Export progress and Cancel take priority over a retained notification. The retained notification keeps
its layout while hidden and inert; ordinary notifications also stay clear of modal controls and their
Tab order. Export from Ctrl+K remains accessible with the keyboard and pointer.

Undo validation reuses the rendered document key and resolves the history entry once per pass,
avoiding repeated document serialization on selection changes. No output goldens changed.
