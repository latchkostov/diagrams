## Mixed reply/deadline cohorts remain an I1 gap

The approved queued-cohort design keeps a caller dot whole and gives it its first wave's outcome. A reply before the shared deadline can therefore complete the caller while its remaining pooled work later times out. Sampling 8b fixes dispatch and edge counters, not this retained caller approximation. Do not loosen I1 to hide it or split callers as part of 8b.

`src/sim/mixedDeadlineCohort.heavy.test.ts` pins a same-arrivals example: twenty isolated bursts of twenty real requests, pool one, 250 ms callee and 600 ms deadline, scales one and ten. Both runs send/process sixty downstream requests and count 360 edge timeouts plus twenty late replies. Caller successes/failures are 40/360 at scale one and 200/200 at scale ten. An accuracy-only `it.fails` checks the unchanged I1 comparison; setup and drain checks stay outside it.

This is the mixed-regime limitation already identified by the approved queued-cohort design, now measured against the same-arrivals reference. Stage 9 owns exploration and any decision on the caller model; generated I1 remains non-gating in 8b.
