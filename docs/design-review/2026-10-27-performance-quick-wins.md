## UX review

Reviewed against the UX principles with a designer agent. No controls, chrome, layout or gestures were
added. Icons remain decorative. Idle chips subscribe to locale changes despite memoization; badges
retain placement, health, thread and fleet readouts, and always refresh open details.

Chart decimation preserves rate and queue extrema, time order and endpoints. Current values and the
accessible low/peak facts remain exact. The hidden rate sequence now follows the plotted extrema.
Fault and narration markers keep their existing behavior.

## Decisions

Rejected averaging samples because it can erase short incidents. Rejected mutating the shared peaks
Map during rendering because abandoned concurrent renders could apply decay. Immutable per-broker
observations resolve that issue and advance decay only with a fresh simulation snapshot.

Existing size limits and reserves stay fixed. Raw numeric DOM diagnostics are E2E-only; visible metrics,
accessible descriptions and data-testid selectors remain available. This is a performance batch and
does not introduce a simulation, planning or stencil feature requiring another showcase.
