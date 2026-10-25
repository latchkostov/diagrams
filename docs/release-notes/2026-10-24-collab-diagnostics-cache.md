## Collaboration diagnostics follow held queues

Room diagnostics now refresh when a sender's frames wait for a binding or grant, finish draining, or
are dropped for later recovery. Subscribers receive the updated queue state without waiting for more
traffic. Cache validity follows the queue maps' identity and membership version, independent of time;
unrelated activity still reuses the cached snapshot.

Targeted regressions cover binding and grant waits, full drains, expiry to recovery, subscriber
snapshots and cached-read operation counts. Restoring the original implementation fails all three
regressions. No output goldens changed; output parity is left to PR CI for this targeted fix round.
