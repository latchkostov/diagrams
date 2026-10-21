## Ledger CPU state across outages, retries and scale edits

One rule now covers every way work reaches an execution thread: acquiring the thread opens
the work segment that owns the cohort's first CPU wave, and CPU, threads and admission are
sized from the work's admitted cohort rather than the live scale. Admission, recovery, a retry
admitted while the worker was down, resource enabling and takeovers all take this path.

- A broker retry that arrived during an outage now hands its remaining cohort CPU to a tail
  after recovery. One recovered scale-10 dot at 100 CPU-ms per request executes 1,000 CPU-ms
  instead of 100, including after a scale edit before recovery.
- Callers recovered after a scale edit size CPU for the cohort their request retained. The
  fc-sweep counterexample (seed -1230053122) left a first wave larger than its cohort and the
  work never completed; it now drains with 20 CPU-ms for two ten-request cohorts.
- An outage cancels the unrun CPU of the attempt it ends, as it already did for retained
  backlogs. The retry charges its cohort once: 1,000 CPU-ms plus what ran before the outage,
  instead of 2,000. The cohort-preservation regression now asserts 4 CPU-ms (previously 7).

Resource invariants additionally require an open work segment on every running ledger thread
and reject CPU above the thread's represented cohort. No parity golden, unit snapshot, I1
bound or release quantization changes; the fixed I1 corpus stays 13/31. No controls or UI text
change.

## Sampling: admit-on-arrival caller turnaround

Turnaround lag (sampling PR 2) now follows the admit-on-arrival phase too. On the ordinary
clock, arrivals at a managed caller admit before that tick's due releases, so only the turnarounds
between a cohort's sequential requests wait for a later phase; its final release precedes the next
arrivals. A one-slot Lambda with zero API latency calling a zero-work service over a zero-delay
blocking connection, at 100 real requests/s for 20 seconds, completes 1,000 and rejects 1,000 at
scale 2 (scale one: 999 and 1,000) instead of 666 and 1,332. At 200/s, scale 2 matches scale one
exactly (1,000 and 3,000, previously 800 and 3,200); scale 1.5 completes 1,000.5 against 1,000
(previously 750). Sub-tick and Lambda-join regressions stay closed; no golden or snapshot changes.
