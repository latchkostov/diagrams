## Dot attachment review round (#252)

No chrome or menu entries are added. A lit dot is the actual attachment committed on drop; the
connection line ends there, and the canvas plus follows the pointer when no eligible dot is near.
Hidden grow handles do not change those decisions. A click on a reconnect end leaves automatic
routing untouched; an intentional drag can fix that end to a dot. Mouse and accessibility click
connections stay supported.

The quick-add gesture keeps the starting dot for both stencil and shape picks, and naming still
belongs to the same Undo step. Zoom updates stay local to connection-radius and viewport components,
including in read-only views. Tests prepare the real pane and zoom before measuring pointer targets;
the body-drop case no longer enlarges the viewport.
