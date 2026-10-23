## Attach connections to any dot

Drag from a node's dot to fix the connection's starting side. Drop on another dot to fix its ending side,
or on the node body to let that end face the source automatically. Each end decides independently;
the "+" starts automatically. Empty-canvas quick-add keeps the starting dot, including for shapes.

A selected connection's round end can attach to another dot on the same node or on another node.
The target's dots appear while connecting, and the nearest dot lights up as the preview snaps to it.
Escape cancels. A reconnect or a change to an existing pair is one undo step and keeps the connection's
identity, label, relationship and settings. Existing pairs never create a duplicate.

Fixing a side still lets connections fan apart on that side. Existing diagrams keep their routing.
Output parity has no intentional golden changes; all existing goldens must remain unchanged.
