## Canvas placement extraction

Internal refactor with no user-visible change: CanvasView composes edit commands, naming, quick-add, connection drops, drag placement and stencil rail drops from `src/canvas/placement/`. Each file owns one placement concept.

Hook order, effect kinds, dependency arrays, camera events, frames, timers and the complete CanvasInner JSX are preserved. Every output golden is unchanged; none is added or re-recorded.
