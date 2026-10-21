## Deadline shipping UX review

The Timeout field, timed-out connection pill, caller details and undoable timeout callout
retain the reviewed #197 interaction. This shipping pass adds no chrome or loading boundary.
The public payment lesson and its ten-second bounded-waiting demonstration remain unchanged.

Simulation documentation now names pooled timeouts at sampled scales as a fifth known
accuracy gap and recommends scale 1 for small capacity boundaries. Scale 1 preserves the
owner's rule: calls that expire in the connection queue are never sent. Only dispatched
work may produce a late reply.

Rejected partial-cohort engine changes in this PR: they require the separate sampling-accuracy
design and would broaden the approved shipping scope. Rejected relaxing accuracy thresholds
or changing sampled ledger assertions: the three mismatches remain pinned expected failures,
with simulation and replay errors kept outside their expected-failure bodies.
