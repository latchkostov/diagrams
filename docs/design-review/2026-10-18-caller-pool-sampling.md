## Review

This correction adds no controls or text to the editor. A caller with a partial pool remains
responsive to edits and eventually drains; occupancy readouts stay within the current pool,
while message counters retain their saved sampling weight. Endpoint wait explanations now agree
with the capacity readout. The existing blocking-call example remains the public showcase.

## Decisions

Rejected global scale refinement: unrelated coprime pools multiply work, disable continuous
traffic and disagree with import budgets. Kept fractional occupancy local to callers, with due
completion heaps rather than scans of every open call. No new chrome, settings or replay of the
run is needed when a pool changes.
