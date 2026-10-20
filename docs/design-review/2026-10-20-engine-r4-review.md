## Engine R4 review UX assessment

This batch repairs execution ownership and request residence without adding controls, labels or
settings. Kafka partition ownership now follows unfinished CPU, queueing respects occupied threads
when a policy changes live, and memory continues to show requests waiting to resume. CPU and memory
readouts retain their existing units and presentation.

The memory contract counts each request reservation once, independently of its execution thread.
This both restores queued-continuation residence and removes the double counting in two older
thread-tail expectations. Existing public waiting examples exercise these behaviors; the batch adds
no simulation, planning or stencil feature requiring another showcase.

## Scope decisions

Keep legacy pre-W1 scheduling and all output goldens unchanged. Applying the new admission check to
legacy sampled execution changed unrelated example schedules, so that extension was rejected.
Preserve numeric execution outside the ledger while using live reservations for sampled W1 work.
No visual or interaction changes require a new control, browser layout adjustment or chrome budget.
