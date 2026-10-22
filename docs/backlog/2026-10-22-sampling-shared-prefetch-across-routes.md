## Sampling accuracy: parallel routes to one consumer share its prefetch window (known gap)

A broker plans a sampled dot across the next routes in turn, and each route's room is its consumer's prefetch window
over that route. The window depends on the route's travel time (`outstanding(slots, target, travelMs)`), so the
budget is per route, as on master. When one dot is shared across several routes to the same consumer, each route
spends the whole window, so the consumer is handed more than scale 1 would hand it.

Measured (`brokerUnits.test.ts`):

| Case                                                                                                               |   Scale 1 | Sampled (per-route budgets) | Rule                                  |
| ------------------------------------------------------------------------------------------------------------------ | --------: | --------------------------: | ------------------------------------- |
| One 100 ms slot, one dot of ten at scale 10: real requests left queued, 1 / 2 / 10 routes                          | 7 / 7 / 7 |                   7 / 4 / 0 | within a dot                          |
| Ten-slot 100 ms worker over thirteen routes beside a 150-slot worker, 20 bursts of 100 at scale 100: narrow worker |       120 |                      222.86 | 102.86 apart, more than one dot (100) |

Both are pinned: an `it.fails` keeps the scale-1 expectation, and a pin records today's numbers.

### History

- Review of #237 at c6012a22 (round 1, P2, "share prefetch room across routes to the same consumer",
  `.reviews/20261022-110438`): the fix kept one window per consumer and divided it across the consumer's routes.
- Review of #237 at dacd1813 (8 P1, `.reviews/20261022-144943`) found the division wrong:
  - a consumer's room divided over its routes can leave every route under one request, so a consumer with room gets
    nothing (two one-slot workers through four routes each stalled at scale 10; the narrow worker above got 0);
  - the room was cached by consumer although it depends on the route's travel time (a 10 ms and a 1,000 ms route to
    one worker completed 107 of scale 1's 191).
- After two fix rounds the owner's rule applied (quarantine and backlog): #237 went back to per-route budgets, keyed by
  route, with regressions for unequal travel times and for consumers with more routes than their windows hold.

### A fix

Plan a dot over consumers, not routes. Allocate each consumer's share (max-min fair, `shareOut`) against one shared
budget, then split the consumer's share over its routes in turn. Each route's own window still bounds it, and every
part keeps at least one real request. The test for the fix is the `it.fails` above, along with the travel-time,
stall and route-order regressions, which must keep passing.
