## Waiting-request review corrections

These engine corrections preserve the existing controls and terminology. Capacity × gives equivalent busy-thread utilization across sampling scales, and pooled calls cannot acquire capacity before their local work makes them ready. No additional chrome or showcase is needed for these narrow fixes.

## Alternatives rejected

Rejected another assignment at the Capacity × call site: requiring Concurrency in the shared factory prevents future construction paths from silently omitting it. Rejected carrying the thread's full elapsed lifetime into pool acquisition because it includes completed local work. No assertions, accuracy bounds or pinned expected failures are loosened.
