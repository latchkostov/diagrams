## Explicit navigation owns the canvas

An unfinished quick-add is a transient choice. An explicit Ctrl+K destination replaces it; leaving
its search visible after navigation is misleading and prevents the camera from settling. Close it
through the existing interaction controller, with the existing command reason, before transferring
focus. Apply the same rule to context menus and navigation to the currently selected node.

Cancelling the command palette still returns to its invoker. This repair runs only when a palette
selection command executes. It adds no chrome and changes no node/edge keyboard navigation rule.
