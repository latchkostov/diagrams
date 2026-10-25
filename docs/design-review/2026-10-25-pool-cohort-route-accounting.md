## Scope and review

Engine accounting correction only: route completion follows an actual journey ending, while retiring a dispatch template releases ownership. No controls, authoring fields or UI copy change. The existing pooled-call examples remain the demonstration.

## Decision

Keep the current chrome and invariant allowances. Defer the lifecycle module extraction in R-e4f3aa3e97 to its dedicated backlog entry; it is unnecessary for this narrow repair. Do not change sampled caller settlement or the documented mixed-deadline approximation in this fix round.

## Lifecycle extraction (fix round 3)

Engine-internal only: the cohort lifecycle moved to `src/sim/poolCohort.ts` with explicit transitions and ordered effects (R-e4f3aa3e97), fixing the cancellation and orphan wave-failure errors. No controls, fields, copy or chrome change. The mixed-deadline caller approximation stays as documented.
