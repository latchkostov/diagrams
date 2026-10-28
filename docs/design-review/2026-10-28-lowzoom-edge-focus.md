## Low-zoom connection focus (#378, final fix)

The wider connection target preserves the familiar click-then-keyboard workflow because it is React Flow's own hit stroke: focus, selection and menus follow the same rules as at 100%, and active gestures and Space panning keep ownership. No controls, settings or visual styling are added.

The browser regression checks offset click followed by ArrowDown, plus the context menu and endpoint reconnection in the same test.
