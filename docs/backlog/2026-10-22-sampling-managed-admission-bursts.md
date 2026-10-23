## Sampling accuracy: managed admission at 2.5 (accepted known gap)

A one-slot Lambda caller with 10 ms of API work, fed by a queue, at 100 real requests/s (`scaleEquivalence.test.ts`,
"managed request admission at scale 2.5"). Real completions / rejections:

| Run                                    | Completed | Rejected |
| -------------------------------------- | --------: | -------: |
| Same-arrivals scale 1                  |       599 |    1,398 |
| Master (stretched partial grants)      |       500 |  1,497.5 |
| 8a-pre (brokers deliver in real units) |       500 |  1,497.5 |
| 8a (throttle split)                    |       399 |  1,597.5 |

At 2.5 every dot is 2.5 requests, while scale 1 fed at the same instants alternates bursts of two and three. The slot
admits one request per burst either way, but what the queue holds back, and so what arrives when the slot frees,
depends on the burst size, and rejection is not linear in it. Every variant measured stays about 100 completions from
scale 1 (master included). The owner accepted it as a known gap (2026-10-22): an exact-number `it.fails` with exact
siblings in `scaleEquivalence.test.ts`. Scales 1.01, 1.1, 2 and 10 match scale 1 within a request.

## Sampling accuracy: callers sharing a throttle divide it by arrival phase

Corpus index 12 (seed 20261018): two one-slot Lambdas share a concurrency allocation of one behind a queue, at 1.5.
Whoever has a dot arriving first after the slot frees takes it, so the division follows the arrival phase against the
hold. The totals match (57 against 57), the division doesn't: 24 / 33 against 28 / 29 (master 28.5 / 30). Scale 1
itself swings with the rate: 39 / 18 at 90 requests/s, 9 / 49 at 95 and 28 / 29 at 100, so no sampling rule can follow
it within a dot. Pinned with an `it.fails` in `scaleEquivalence.test.ts`.

## Sampling accuracy: a dot its caller awaits is not split

A call settles on its branch's first reply, so a callee can't answer one dot with two outcomes. A throttle at a node
reached by a call therefore keeps today's stretched partial grant. Splitting there needs the caller's attempt to settle
in parts (its cohort splitting on a partial failure), a follow-up design.
