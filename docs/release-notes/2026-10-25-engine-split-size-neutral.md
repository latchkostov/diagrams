## Engine split 1: compact internal wiring

The structural model and accounting modules remain separate. Accounting now receives synchronous functions
as positional parameters and returns a typed tuple, so internal port and operation names do not become
unmangleable JavaScript properties. Operations used only by the facade are returned directly without extra
captured bindings.

The facade retains its scalar counters, event ring and route-counter allocation. Its public frame projection
and private waiting-list ranking stay beside the particles, faults, resources and routes they read. Accounting
still owns message bookkeeping, tracing, latency, throughput and snapshot formatting. Checkpoints preserve
their original graph and scalar fields.

Node parity checked 3,045 goldens with zero changes; none were re-recorded. Compression settings and bundle
budgets remain unchanged.

## Production size comparison

Compared with merge-base `495c0ca9ca8a56897d82252300437a1f4043538a`, using production builds and gzip level 9
per JavaScript file. The LiveSession closure counts each static dependency once; total app JavaScript includes
both simulation workers.

| Payload                    | Raw delta (B) | Gzip delta (B) |
| -------------------------- | ------------: | -------------: |
| LiveSession chunk          |             0 |             -3 |
| LiveSession static closure |          +126 |           +196 |
| Simulation chunk           |          +126 |           +187 |
| Simulation worker          |          +203 |           +138 |
| Evidence worker            |          +215 |           +123 |
| Viewer manifest JavaScript |          +226 |           +121 |
| All app JavaScript         |          +544 |           +565 |

Every affected chunk and the LiveSession closure stay within +200 gzip bytes. Total app JavaScript stays
within +1,000 bytes both raw and gzip. These measurements replace the unresolved size acceptance in the
original extraction review.
