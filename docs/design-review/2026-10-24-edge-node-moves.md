## Moving nodes with shaped lines

Reviewed the approved PR 4 behavior against the chrome budget and undo contract. No controls or
menu rows are added. Bends follow both ends while dragging, including boundaries and copies;
a single moved end rejoins without losing the person's shape. Tidy and Auto-layout explicitly
report automatic-route resets with the existing Undo toast pattern. One action restores both
the node positions and bends.

Browser coverage uses the actual selection box, boundary label drag handle and Tidy inspector
action. It fits the selection after the inspector opens before measuring pointer targets.
Render-count coverage confirms unrelated shaped edges do not render during a node drag, and
the existing click/type/drag guard passes. A counted-work check rejects quadratic carry preparation.

Keyboard segment editing, touch shaping and interop changes remain in their approved later PRs.
