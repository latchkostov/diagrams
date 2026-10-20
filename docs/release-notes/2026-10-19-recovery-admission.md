## Outage recovery uses the admission transaction (PR #206, third review)

Restoring a caller now checks execution slots, endpoint concurrency and shared allocations in
one capacity-only admission transaction. When a sibling owns the released shared allocation,
recovery waits and resumes when it is free. Recovery preserves remaining service time, retry
backoff and already-spent quota. Off-thread reply continuations regain their managed execution
slot. Message tracing also finds continuations awaiting takeover.

The per-tick resource oracle checks endpoint/shared caps and exact admission occupancy against
live leases. Generated command scenarios now include managed callers, retained retries, shared
allocations and status changes without intervening ticks; a generated outage command guarantees
down/up during shared-allocation backoff. Focused regressions also pin the two-attempt quota and
downstream dispatch at 120 ms after local recovery.

No output golden is intentionally changed, including scale-one output. No tolerances change.
