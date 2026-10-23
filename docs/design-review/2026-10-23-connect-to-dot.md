## Attach to a dot

Designer source review against the approved design found no blocking UX issues in the dot and body flows.
Each end keeps its own choice. Reconnecting on the same node changes only the chosen side; a body drop
on another node clears only the moved end. The candidate node exposes all four dots, the nearest dot
uses accent fill and a halo, and the body glow dims. Escape follows the controller's cancellation path.
There are no additional controls, menu items or UI strings.

The review rejects extra side-picker chrome: existing gestures and Advanced fields cover the choice.
It also rejects discarding the starting dot on a body drop, and treating the "+" as a fixed side.
Fixed sides continue to fan apart; exact offsets and hand-shaped lines remain later work.

Browser verification covers the rendered path starting at the dot, stored sides, same-node and other-node
reconnects, meaning preserved, one-step undo, highlighted dots and Escape without an undo step. The existing
D8 and accessibility cases retain their assertions. Unit regression verification temporarily restores the
old same-node rejection and confirms the new test fails, then restores the fix.

An additional browser check found that React Flow prioritizes a dot's invisible hit area over the
nearest handle centre, including beside the "+". The shared hit test now follows that priority so
preview and commit agree. It also uses raw pointer coordinates rather than grid-snapped coordinates;
a radius-boundary unit regression covers the distinction. Neither rule changes the diagram's snapping setting.

The legacy shape-connection cases now assert the exact right/left sides chosen by their dot drags, retaining
their resolved-side and endpoint checks. Body-drop cases zoom the relevant nodes into view so the drop is
outside the enlarged snap zones; the original routing and reconnect-meaning assertions remain unchanged.
