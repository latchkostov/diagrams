## Canvas menu extraction

Internal refactor with no user-visible change: CanvasView composes menu state and context-menu handlers from `src/canvas/menus/`. The existing menu JSX, action registration, selection behavior, translations and camera events are preserved.

Every output golden is unchanged; none is added or re-recorded. The completed file map and before/after line counts are in the [UX review](../design-review/2026-10-17-canvas-menu-split.md).
