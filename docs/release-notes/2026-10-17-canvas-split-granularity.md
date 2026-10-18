## Canvas module granularity

Internal refactor with no user-visible change: keep overlay state and measurement hooks with CanvasOverlays, keyboard pan handling with canvas navigation, and shared node type guards with the existing flow types. Hook order, dependencies, DOM, styling and camera events are unchanged. No parity golden is intentionally changed.
