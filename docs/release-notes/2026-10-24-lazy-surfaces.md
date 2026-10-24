## Lazy surfaces and bundle headroom

Inspector, Live, hover, edge reader and slow-motion readout downloads now share a registered,
machine-backed loading primitive. Existing pending frames, held naming, keyboard controls and
inline recovery remain. A single shell-owned failure toast retries failed active surfaces,
including surfaces sharing a chunk. Reopening retries a failed download even after its toast goes.
Image export and recording await active output-bearing surfaces; editor-only UI and data exports
are skipped. The same readiness hook is available to a future print command.

The generated browser contract iterates all 32 registered surfaces with real entry points and
held/failed chunks. Additional generated image-export cases cover the four output-bearing surfaces.
Existing specialised hold tests remain because they also check styling, cursor, held typing,
field order, modal cancellation and slow-motion behavior.

Benchmarks reports gzip bytes, PR deltas against the actual merge-base and headroom for every
existing bundle budget. Headroom below 8,192 B warns and schedules a dedicated trim; only exceeding
a fixed limit fails. CanvasView's static inspector Fields/Panel imports are guarded by lint.

No parity goldens are changed or re-recorded. This refactor adds no simulation, planning or stencil
feature; its invented recovery fixture is available in the Lab as `lazy-surfaces`.
