## Canvas selection and keyboard extraction

Internal refactor with no user-visible change: box picking, pointer-up selection settling,
Space/Alt/middle-button gestures, keyboard navigation, roving focus, dependency selection
and history announcements now live in `src/canvas/selection/`. Shared node-kind predicates
live in `src/canvas/nodeKinds.ts`.

The hooks keep their existing positions, effect kinds, dependency arrays, camera holds,
reveal events, animation frames and timers. No output goldens are changed or re-recorded.
