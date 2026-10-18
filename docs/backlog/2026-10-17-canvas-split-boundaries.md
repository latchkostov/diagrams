## Split the rest of CanvasView

The camera now lives in `src/canvas/camera/`, and CanvasView only dispatches events to it
(`docs/release-notes/2026-10-17-camera-controller.md`). The rest of `CanvasView.tsx`, about 2,600 lines, can
split along these boundaries, one pure-move branch each, in the same way: the same hook order, effect kinds and
dependencies, and tests that change only their imports.

- **Selection and keyboard** (`src/canvas/selection/`): the selection box and its pick, `settledEmpty` and the
  pointer-up settle (which holds the camera's readiness through `controller.hold()`), Tab, arrow and edge
  navigation, roving focus and the live-region announcements. It dispatches `reveal.requested("navigation")`.
- **Edit commands and placement** (`src/canvas/placement/`): `pickNamed`, quick-add (`growTo`, `cloneTo`, the
  connection drop), drops from the rail, Alt-drag copies, membership settling and text moving clear. It calls
  `controller.placing()` before it places anything, and `panForConnectedMenu` for quick-add's room.
- **Menus** (`src/canvas/menus/`): `openMenu` and the node, edge, selection and pane context menus. The menu's
  kind goes to the camera as `menu.opened` / `menu.closed`, so pane work waits for it.
- **Overlays and chrome** (`src/canvas/chrome/`): the title card, Checks markers and card, the start card, the
  first-run hint, the present bar, minimap and controls, and the overlay test ids.
- **Autosave and document identity** (`src/canvas/document/`): `flushSave`, example promotion, page-hide flushes
  and conversation retention.
- **canvas.css and Inspector.tsx**: separate branches, as planned.

Each split should follow the camera's rule: no new effect moves the view; a behaviour change is a new event or
policy row (`src/canvas/camera/index.ts`).
