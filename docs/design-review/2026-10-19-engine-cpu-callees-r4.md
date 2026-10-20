## Engine CPU share and callees R4 UX review

This refactor changes simulation accounting and first-wave completion; it adds no controls or UI text.
Existing readouts keep their units; occupancy uses retained reservation weights, while CPU includes
unfinished cohort work. A logical success remains visible after it answers, while sampled capacity
and CPU can continue draining independently.

The implementation preserves scale-one and older-revision output contracts. Existing public waiting
examples exercise the behavior; this internal refactor does not add a simulation, planning or stencil
feature requiring a new showcase. The designer reviewed public source and regression tests and found
no new UX issues; no visual session was needed. Pure callees keep their existing presentation: they
use ledger weights internally without gaining the caller-only thread meter.
