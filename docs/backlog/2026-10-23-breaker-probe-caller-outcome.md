## A narrowed breaker test leaves its caller's dot one outcome

At scale > 1, a half-open breaker narrows a dot to its remaining test calls and short-circuits the rest on the connection (`narrowProbe` in `src/sim/engine.ts`). The caller's own dot is not split: it awaits one reply per branch, and splitting a caller mid-call would also split its thread, request lease, broker delivery and any upstream call it answers (`splittable` excludes awaited work for the same reason). So the whole caller dot takes the test calls' outcome.

When the tests fail, that is exact: at scale 1 the tested and the short-circuited requests both fail. When they succeed and the breaker closes, the caller counts the dot's short-circuited part as succeeded rather than failed: at most `scale - halfOpenCalls` real requests, once per recovery, within the I1 bound. Measured at 3,600/s and scale 100: gateway processed/failed differ from scale 1 by 95 real requests per closing batch; every connection counter matches.

The same limit applies to a caller thread held for the whole dot while only the test calls are in flight. A call-level split (a sibling call for the refused part) would close it.
