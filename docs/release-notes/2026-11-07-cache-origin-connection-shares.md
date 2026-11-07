## Cold-cache sizing respects origin connection shares

Cold-cache Checks now apply the same connection shares as demand propagation for read-through
caches and cache-aside callers. A cache receiving 200 requests/s with a 10% origin connection
projects 20 requests/s to that origin; a 10 requests/s service therefore needs four replicas at
the existing 55% sizing target, instead of the previously suggested 37.

Regression tests cover projected demand, cold propagation and replica fixes for both cache paths,
using actual cold-cache probes. No parity goldens change.
