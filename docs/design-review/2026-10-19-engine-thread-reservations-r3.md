## R3 thread reservation review

Designer source review of the engine readouts, ThreadMeter, NodeDetails and unit conversion found no
need for additional controls, wording or a public showcase for this internal refactor. Existing
working and waiting fields express reserved weight divided by sampling scale; real-unit conversion
continues to serve the existing meter. Resident requests remain separate from thread occupancy.

Live shrink preserves existing reservations and can truthfully report
four held units against a newly configured one-slot pool. The current meter clamps its fill while
the label can report four of one. This matches scale-one execution: four waiting requests remain
against one slot for about 60 ms after a 4-to-1 shrink. Keep that truthful reading until existing
work drains, with no new admissions above capacity. The updated tests compare each tick against
scale one and separately check admission and monotone drain.

Filtered local-work and oversized mixed fan-out throughput now match the unchanged assertions.
Local fractional carry survives logical completion, continuation takeover avoids an extra work
slice, and pool dispatch retains its prior phase. No additional controls or example are needed for
this internal engine migration; existing public waiting examples already exercise these readouts.
No visual walkthrough was performed; this review is limited to source and deterministic readouts.
