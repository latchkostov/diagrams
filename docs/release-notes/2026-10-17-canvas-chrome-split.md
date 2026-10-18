## Canvas chrome extraction

Internal refactor with no user-visible change: title and Checks cards, empty/start states,
presentation controls, minimap, grid, zoom CSS variable and first-run hints now compose from
`src/canvas/chrome/`. Overlay measurement and hint hooks keep their original call order.
All DOM, text, ARIA, test ids, styles and camera events are unchanged. No output goldens
are changed or re-recorded.
