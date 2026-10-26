## Naming click-away review

Click-away accepts buffered names and leaves focus at the clicked destination. The editor-mode table
owns this transition during naming and committing, then releases the keyboard without requesting item
focus. Delayed measurement cannot reopen the finished edit. Escape retains its existing placement
behavior. No controls or chrome were added.

Regression coverage holds measurement for quick-add and clone, clicks the original node, verifies the
saved name and destination focus, and checks Undo/Redo. Cold-inspector tests keep their tooltip,
name and focus outcomes while observing the current completion path.
