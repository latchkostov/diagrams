## Move legacy node drag adapters into the interaction controller

The pure gesture machine reserves node.drag and its origin map. Integrate React Flow node drag
start/stop with the carry preview in edge-editing PR 4, together with real cancellation semantics.
Reporting an Escape cancellation while React Flow still commits the node move would change existing
behavior, so PR 1a leaves node drag ownership as it is.

The existing Alt-drag, insertion, membership and guide observers still use local refs/listeners.
Move those adapters, box selection, shape resize and sheet resize into controller gestures in
separate changes. Preserve their undo, boundary and guide behavior.
