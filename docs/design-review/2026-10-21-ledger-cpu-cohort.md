## Ledger CPU cohort consistency: UX review

Reviewed against the UX principles: executed CPU and completion now match the requests a
sampled dot represents after outages, in-place retries and live scale edits, so readouts no
longer under- or over-charge recovered work or leave it stuck. The correction adds no controls,
inspector fields, interaction changes or public showcase; existing queue-worker and waiting
examples already exercise these transitions. Call-site special cases were rejected in favour
of one acquisition rule and one cohort source; widening `callerReservations`, release
quantization and weaker assertions were rejected as outside the approved step.

## Admit-on-arrival turnaround: UX review

Managed callers with zero-delay calls again complete at their scale-one rate instead of showing
artificial throttling rejections. No controls, text or showcase change; the rule lives in the
turnaround-lag computation, not at a call site.
