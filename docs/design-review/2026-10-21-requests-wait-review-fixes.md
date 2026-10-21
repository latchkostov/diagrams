## Requests that wait: review corrections

Live's existing Why disclosure now renders busy-thread metrics through the same metric-kind formatter used for scenario sizing. Percentage targets retain Concurrency units; absolute targets retain threads per pod. Neither becomes a memory label, and no new control or global chrome is added.

The simulation counts working and held threads, while off-thread calls and calls queued off-thread behind a pool remain outside the busy-thread metric. Blocking and non-blocking configurations retain the established Connection pool control and queue behavior.

Separate CPU/memory target controls for KEDA and CPU-limited static sizing remain explicit P2 follow-ups in the review backlog fragment. This batch adds no new simulation, planning or stencil feature; the existing public examples remain its showcase.
