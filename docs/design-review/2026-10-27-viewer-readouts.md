## Fix-round UX review

Reviewed against the UX principles: playback, visible readouts, controls and layout retain their
existing behavior. Production badge attributes remain available across standalone and embedded
viewers. No new controls or showcase feature are introduced.

## Decisions

Rejected enabling all E2E hooks in production viewers: their deterministic, isolated builds should
keep those hooks disabled. Restore the existing badge attributes instead, with comparator coverage
for their values. Keep memoized leaves and per-broker peaks to preserve the render-count improvement.
Do not raise test timeouts or change Overview assertions; reduce only its redundant zoom setup.
