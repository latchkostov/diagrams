## Boundary membership indexing — R-6ab02df389

Replace repeated sibling-array copies in FrameDetail and zoneViewport with append-only arrays
owned by the new index, and avoid building the FrameDetail index without zone traversal. This
needs a shared implementation decision and operation-count regression coverage; it is more than
a one-line fix and is deferred from the final P1 fix round.

## Presentation route parity — R-8a51f62eae

Share displaced Focus/Follow pin routes with the visible stroke, broad hit target and selection
halo. Restore all surfaces together during capture. This spans route presentation and capture
lifecycle, so it needs dedicated pointer/highlight/capture regression coverage rather than a
one-line selector change in this round.

## Bounded chart grid — R-5e870172ef

Use duration- or pixel-based grid ticks with a capped count, reusing them until the chart window
changes. Add long Free play operation-count coverage and preserve useful labels for short runs.
This needs a tick policy and is deferred rather than changing chart semantics incidentally.
