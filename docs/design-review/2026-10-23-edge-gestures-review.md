## Line editing review round (#248)

The fixes restore the existing click alternative to dragging and make cancellation visibly final: the line and glow disappear, panning stops, releasing performs no edit, and the next connection works. No controls or menu entries are added. Pointer feedback stays local to the connection line or the dragged edge; the inspector and canvas shell retain stable state. Browser tests exercise real handle drags, mouse clicks and accessibility-style activation on both server targets.
