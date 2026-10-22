## Sampling accuracy: brokers deliver in real units

A broker's prefetch window now counts real requests, as at scale 1. It holds a consumer's slots, what is on the way to them and one more (slots + ⌈slots × travel ÷ service⌉ + 1), counted with `unitsOf` over thread weights, deliveries in flight, queued and staged work. Before, a processor's window was the same formula in dots, so at scale 10 a four-slot consumer could be handed thirty requests where scale 1 hands it six. Stores and gateways, which serve a dot as one message, keep their window in dots.

A dot that doesn't fit the room is delivered in part, and the rest stays at the front of the queue. Each part, and each remainder left queued, keeps at least one real request: a smaller sliver would cost its consumer a whole service turn. A dot overshoots the room by less than one real request rather than leave a sliver. Competing consumers share a dot: scale 1 hands a burst's members to the consumers with room one at a time, so a dot goes to the next consumers in round-robin order (at most one per real request; the cursor then moves past them, so every consumer takes its turn even when a dot is smaller than the number of consumers), in max-min fair parts each capped by its consumer's window: equal, and what one can't take goes to the others equally, so route order doesn't matter. A deny route is decided before any capacity, as before: on its turn it takes the dot whole, whatever the consumers' or the group's room. Every consumer shares a group's room. Each route has its own window budget, as on master, because the window depends on the route's travel time; parallel routes to one consumer therefore each spend a window when one dot is shared across them, a known gap ([backlog](../backlog/2026-10-22-sampling-shared-prefetch-across-routes.md)). A dot of less than two real requests goes whole to the next consumer with room, as every dot does at scale 1, so scale 1 is unchanged.

The broker's counters (deliveries outstanding and off-thread, per group and per consumer) and its backlog and lag are now in dots, so a remainder reads as its share of a dot, and KEDA and the other broker metrics read real requests. Work that counts messages for occupancy (`threadOccupancy` outside the call graph, resident requests, the in-flight metric) counts each by its dots, so a part no longer costs a whole dot's capacity. Occupancy reads a per-node sum of working dots kept with the working set, so admission stays constant-time per message. A live scale change recounts these cached sums, because a part's share of a dot follows the scale. Continuations queued to resume count by their dots too, and measure() and frames share one backlog. Latency samples weigh their dots: a dot delivered in parts adds up to one sample, so Billing spike's waiting share stays 78% (a sample per part read 82%). Percentiles over fractional weights rank by weight (whole samples keep nearest rank), and a positive count reads at least one finished message (a part of a dot finished), never zero.

## The same-arrivals oracle

`EngineOptions.sameArrivals` (test-only) runs scale 1 at the arrival instants of the scale `setScale` names: every dot a source or injection emits arrives as floor-cumulative real requests. It replays the I1 harness's reference exactly and gives every simulation golden a reference (`src/test/sameArrivalsGoldens.ts`); `docs/PARITY.md` lists all 60 changed goldens by the owner's rule (away only if more than one dot further from scale 1 than master; share-sampled counts are noise). Three move away, one class, now named gaps: blocking-call free play (11,854 at scale 1; master 13,710; now 14,643) and busy-thread blocking (11,928; 11,982; 11,993). See [the backlog](../backlog/2026-10-22-sampling-slow-callee-without-pool.md).

## Message volume

A part is one more message. In five representative runs parts were 13% to 60% of all messages: delivery-dispatch dinner rush 13%, Black Friday partner quota 22%, blocking-call free play 30%, observability log storm 30%, and the planner-partitions fixture at scale 5, whose one starting replica has a window of six requests, barely over a dot, 60%.

## Accuracy comparison

Measured with `src/test/scaleEquivalence.ts`: seed 7, 100 real requests/s, 20 seconds; master 4877f5dce3595a83af56043f726fb1f929fedd87. C / R means real caller completions / rejections. Managed admission at 10 moves away until sampling 8a: a throttled Lambda now receives parts of three requests instead of dots of ten, and stretch admits them. 8a's throttle split takes it to 398 / 1,592, scale 1 exactly. The fixed 40-sample I1 corpus passes 17/31: index 8 now passes, and every index master passes still does.

| Fixture                         | Scale | Same-arrivals scale 1 C / R |     Master C / R |     Branch C / R | Direction |
| ------------------------------- | ----: | --------------------------: | ---------------: | ---------------: | --------- |
| Managed zero-work, zero network |  1.01 |                  990 / 1009 | 669.63 / 1329.16 | 669.63 / 1329.16 | same      |
| Managed zero-work, zero network |   1.1 |                  909 / 1090 |   699.6 / 1299.1 |   699.6 / 1299.1 | same      |
| Managed zero-work, zero network |     2 |                  999 / 1000 |      1000 / 1000 |      1000 / 1000 | same      |
| Managed zero-work, zero network |   2.5 |                  799 / 1200 |      1000 / 1000 |      1000 / 1000 | same      |
| Managed zero-work, zero network |    10 |                  199 / 1800 |      1000 / 1000 |      1000 / 1000 | same      |
| CPU-bound standalone            |  1.01 |                     199 / 0 |       189.88 / 0 |       189.88 / 0 | same      |
| CPU-bound standalone            |   1.1 |                     199 / 0 |        199.1 / 0 |        199.1 / 0 | same      |
| CPU-bound standalone            |     2 |                     199 / 0 |          200 / 0 |          199 / 0 | closer    |
| CPU-bound standalone            |   2.5 |                     199 / 0 |          200 / 0 |          200 / 0 | same      |
| CPU-bound standalone            |    10 |                     198 / 0 |          200 / 0 |          198 / 0 | closer    |
| CPU callee, one connection      |  1.01 |                     399 / 0 |       398.95 / 0 |       398.95 / 0 | same      |
| CPU callee, one connection      |   1.1 |                     399 / 0 |        399.3 / 0 |        399.3 / 0 | same      |
| CPU callee, one connection      |     2 |                     399 / 0 |          400 / 0 |          400 / 0 | same      |
| CPU callee, one connection      |   2.5 |                     399 / 0 |          400 / 0 |          400 / 0 | same      |
| CPU callee, one connection      |    10 |                     397 / 0 |          400 / 0 |          400 / 0 | same      |
| CPU-design fixture, no pool     |  1.01 |                     570 / 0 |       569.64 / 0 |       569.64 / 0 | same      |
| CPU-design fixture, no pool     |   1.1 |                     570 / 0 |        569.8 / 0 |        569.8 / 0 | same      |
| CPU-design fixture, no pool     |     2 |                     498 / 0 |          498 / 0 |          498 / 0 | same      |
| CPU-design fixture, no pool     |   2.5 |                     498 / 0 |        497.5 / 0 |        497.5 / 0 | same      |
| CPU-design fixture, no pool     |    10 |                     496 / 0 |          500 / 0 |          500 / 0 | same      |
| Legacy queue worker             |  1.01 |                    1997 / 0 |      1996.77 / 0 |      1996.77 / 0 | same      |
| Legacy queue worker             |   1.1 |                    1997 / 0 |       1996.5 / 0 |       1996.5 / 0 | same      |
| Legacy queue worker             |     2 |                    1997 / 0 |         1998 / 0 |         1998 / 0 | same      |
| Legacy queue worker             |   2.5 |                    1996 / 0 |       1997.5 / 0 |       1997.5 / 0 | same      |
| Legacy queue worker             |    10 |                    1989 / 0 |         1990 / 0 |         1989 / 0 | closer    |
| Sub-tick work                   |  1.01 |                     499 / 0 |       498.94 / 0 |       498.94 / 0 | same      |
| Sub-tick work                   |   1.1 |                     499 / 0 |        499.4 / 0 |        499.4 / 0 | same      |
| Sub-tick work                   |     2 |                     499 / 0 |          500 / 0 |          500 / 0 | same      |
| Sub-tick work                   |   2.5 |                     499 / 0 |          500 / 0 |          500 / 0 | same      |
| Sub-tick work                   |    10 |                     497 / 0 |          500 / 0 |          500 / 0 | same      |
| Lambda join                     |  1.01 |                  494 / 1503 | 398.95 / 1598.83 | 398.95 / 1598.83 | same      |
| Lambda join                     |   1.1 |                  484 / 1513 |   399.3 / 1598.3 |   399.3 / 1598.3 | same      |
| Lambda join                     |     2 |                  499 / 1498 |       500 / 1498 |       500 / 1498 | same      |
| Lambda join                     |   2.5 |                  399 / 1597 |     500 / 1497.5 |     500 / 1497.5 | same      |
| Lambda join                     |    10 |                  398 / 1592 |       500 / 1490 |       465 / 1525 | closer    |
| Fragmentation                   |  1.01 |                     999 / 0 |       998.89 / 0 |       998.89 / 0 | same      |
| Fragmentation                   |   1.1 |                     999 / 0 |        998.8 / 0 |        998.8 / 0 | same      |
| Fragmentation                   |     2 |                     999 / 0 |         1000 / 0 |         1000 / 0 | same      |
| Fragmentation                   |   2.5 |                     998 / 0 |         1000 / 0 |         1000 / 0 | same      |
| Fragmentation                   |    10 |                     995 / 0 |         1000 / 0 |         1000 / 0 | same      |
| Managed admission (siblings)    |  1.01 |                  662 / 1335 | 399.96 / 1598.83 | 399.96 / 1598.83 | same      |
| Managed admission (siblings)    |   1.1 |                  635 / 1362 |   399.3 / 1598.3 |   399.3 / 1598.3 | same      |
| Managed admission (siblings)    |     2 |                  499 / 1498 |       500 / 1498 |       500 / 1498 | same      |
| Managed admission (siblings)    |   2.5 |                  599 / 1398 |     500 / 1497.5 |     500 / 1497.5 | same      |
| Managed admission (siblings)    |    10 |                  398 / 1592 |       500 / 1490 |       597 / 1393 | **away**  |
