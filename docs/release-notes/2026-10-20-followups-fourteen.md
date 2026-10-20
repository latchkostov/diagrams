## Annotation shape polish and self-host coverage

Connections now meet each shape's visible outline. Rendering, handles and routed endpoints use the
same geometry, including spread ports, and changing an outline invalidates routing caches. Narrow
Delay shapes keep their arc inside their bounds; triangle labels remain visible when made wide and
short; window-pane dividers leave a clear cell for words.

Connected quick-add previews and creation share a destination-aware placement planner. The menu
reserves room for both shape and stencil sizes, keeping pointer targets stationary while the preview
changes. Shape insertion through the picker or direct command search moves keyboard focus to the
new shape. Buffered annotation editing keeps newlines and saves on Escape, Tab or Mod+Enter, with
the same focus handoff as an editor that is already open. Both shape catalogs stay collapsed while
browsing commands and expose their leaves through search.

Shift corner resizing makes a square/circle from a rectangular start and preserves the opposite
corner. Modifiers are read only from the active gesture; bulk selection adds no per-annotation Shift
listeners. Extended Mermaid labels use YAML-safe quoted strings and preserve paths, tabs and literal
escape sequences.

Server tests inject a deterministic memory limit. The existing self-host CI smoke job now also admits
two browsers and verifies edits in both directions through nginx and Caddy at root and subpaths, with
CSP and page-error checks. Those deployments have a separate socket quota; existing two-socket and
spoofed-forwarding assertions remain intact.

Parity changes: `node/annotation-shapes/outlines.svg` moves only the window-pane dividers to the top
and left fifths. New `node/annotation-shapes/narrow-delay.svg` freezes the corrected 40×100 elliptical
Delay arc. New `node/annotation-shapes/attachments.json` freezes attachment coordinates for all 44
outlines at default, narrow/tall and wide/short sizes, including spread ports.
`node/routes/corpus-annotation-course.json` changes the shape endpoints, paths and dependent label
positions for smoothstep, Bézier and straight routes to meet the visible strokes rather than box edges.
