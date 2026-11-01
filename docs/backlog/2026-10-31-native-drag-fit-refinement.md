## Measure drag geometry after the camera's final fit

Round-five diagnostic Nightly 41263869369, Windows shard 5, fails the equal-spacing drag: the guides show zero gaps and the node reaches x=810 instead of the unchanged expected x=800. Its trace samples zoom 0.859223 after a temporarily stable viewport. Before the subsequent node bounding-box read, the initial fit refines to zoom 0.851942. The driver then multiplies its exact 803/-297 offset by the older zoom.

Drag preparation now acknowledges the existing camera-idle signal before measuring either zoom or node bounds. The guide-activation origin acknowledgement, all real pointer events, exact requested offsets, two-gap assertion, exact snapped position, free-drag tolerances and Undo checks remain unchanged. The preparation helper and viewport parser are extracted for a deferred-fit regression that requires neither zoom nor node-box measurement before the camera completes, then requires both refined values.

A proposed product grid-offset explanation was rejected after reading the pinned React Flow implementation: it retains raw pointer coordinates for drag offsets. No product drag, grid, camera, tolerance, timeout, budget, skip, quarantine, retry or golden changes are made.
