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

## Connect-to-dot review fixes (#252)

While a connection or reconnect is held, the viewport moving under a still pointer (auto-pan at the canvas edge, a zoom) re-resolves the preview from the pointer's last position: the line's end, the "+" and the lit target stay under the pointer, and the drop commits what was shown. A drop on the source node's own body, or on a note or text that takes no connections, stays rejected even when another node's dot is within snapping reach.

Tests cover source-end dot reconnects (same node and another node: the source side changes, the target's attachment and the edge's meaning stay, one undo), the plus staying under a still pointer through auto-pan, rejected bodies beside a dot at low zoom, and React Flow's snap radius following the resolver across zoom steps. Output parity: no goldens changed.
