## Keyboard parity at deferred menu boundaries

The existing Retry control is reachable by native keyboard traversal after failure. The controller
keeps the queued pick while recovery owns focus, then hands it to the loaded menu. Naming uses one
field descriptor for focus and persistence, keeping Subtitle edits out of Label. Search replay applies
text and directional selection together, including modified deletion and navigation.

No controls, copy or menu rows are added. Rejected clearing the input queue on failure because it
would lose the intended pick and name; rejected dropping modified keys because it changes the eager
menu's editing behavior. Browser comparisons observe the query before selecting an item, and observe
saved names and node focus before releasing the inspector download. The tests retain one-step undo.
