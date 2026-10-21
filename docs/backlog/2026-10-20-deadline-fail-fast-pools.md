## Bound planned pool capacity by fail-fast joins (#197 review)

Keep individual connection-pool constraints until the parallel join's failure time is known,
then bound each hold by the earlier of its response and join failure. A non-blocking 1,000 ms
branch with one connection and a sibling timing out at 100 ms currently plans 1 request/s,
while scale-one playback releases sibling reservations and dispatches 5 requests/s without backlog.
This planning change is deferred from the accounting and UI review fixes.
