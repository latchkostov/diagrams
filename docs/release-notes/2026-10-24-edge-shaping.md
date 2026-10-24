## Shape lines by dragging

A single selected orthogonal line now shows segment handles. Drag an inner segment to move it, or an
end segment to add a jog. Automatic routes freeze as drawn on their first effective drag. A dashed
preview keeps the document unchanged until drop; each drag is one undo step. Align neighbours to
merge bends and return a straight line to automatic. Snapping prefers ports, other segments and nearby
node edges/centres before the grid; Ctrl/⌘ drags freely.

Handles avoid label pills, load only on selection, and stay out of Live, presentation, read-only views
and image exports. The shortcuts sheet and drawing interaction docs explain the gestures. The Lab's
Edge shaping preset uses the existing hand-shaped-lines corpus. Particles already follow the drawn
path; travel duration remains the configured duration, so longer lines move particles faster.

Node-move carry, keyboard/touch shaping and interop/agent authoring remain the later roadmap stages.
Automatic Bezier samples and diagonal Straight segments are not offered as orthogonal handles;
existing shaped lines still follow the viewer's chosen corner style.

## Golden inventory

No diagram, route, layout, render, image or HTML goldens changed. No new selection golden was needed.
The required new English strings cause the catalog i18n parity hashes to differ; the existing golden
has been retained pending the owner's answer about the brief's no-existing-golden-changes constraint.
