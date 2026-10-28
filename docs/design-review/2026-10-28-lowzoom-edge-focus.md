## Low-zoom connection focus (#378, final fix)

The wider connection target now preserves the familiar click-then-keyboard workflow. Focus goes through the existing controller after a primary forwarded click on a selectable canvas; context clicks and read-only canvases do not move focus. Active gestures and Space panning keep ownership. No controls, settings or visual styling are added.

The browser regression checks offset click followed by ArrowDown before any helper can focus the canvas. Context-menu and endpoint-reconnection coverage remains in the same test.
