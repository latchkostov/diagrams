## Keyboard boundary commands and navigation

Boundary transfers can leave large boundaries and nested ancestors, keep each source subset together,
and fail without changing the document, selection or Undo history when a later subset has no room.
Zones and text remain backdrops when finding room inside a destination. Destination growth keeps the
full moved set inside, respects unrelated nodes and boundaries, and reverses with the move in one Undo.

After a transfer, the view reveals the invocation's focused surviving node, with the first selected
node as fallback. Inspector commands keep keyboard focus in the Inspector. Boundary choices share one
document snapshot, indexed membership counts and bounded ancestor breadcrumbs, including for deeply
nested imported diagrams. Inspector availability is declared by each action's registration. The node and selection context menus
fold Add boundary, Add to boundary and Remove from boundary under Boundary, keeping their item budget.
Palette and Inspector routes remain direct.

Edit keyboard edge navigation enters readable Focus strictly below 50%. Live retains its existing
below-60% behavior. No output parity goldens changed in this fix round.
