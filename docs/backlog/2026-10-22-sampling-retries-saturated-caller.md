## Sampling accuracy: jittered retries at a saturated caller fed by broker parts (known gap)

Found when #236 (retries) merged into 8a-pre. The fixture: a queue feeds a four-slot caller whose partner always fails
(`brokerUnits.test.ts`, "retries of a broker's parts"). The caller retries twice, then the queue redelivers. It uses
`resilienceFixture`'s 200 ms deadline and exponential backoff, at 100 real requests/s for 15 s.

| Backoff  | Scale | Scale 1 attempts | Sampled attempts | I1                                            |
| -------- | ----: | ---------------: | ---------------: | --------------------------------------------- |
| jittered |     2 |            8,870 |            8,824 | passes                                        |
| fixed    |    10 |            8,804 |            8,756 | passes                                        |
| jittered |    10 |            8,835 |            8,622 | fails (partner.failed 196 apart, bound 195.5) |

At scale 10 the sampled run is about 2% low on every seed tried (1, 7, 17, 42, 99). Master's whole dots read 8,870
(seed 7) and are unbiased. The bias appears only where the caller is saturated: a two-slot caller is 0.7% low, and an
eight-slot one is unbiased. Without retries, or with fixed backoff, the run matches scale 1.

The broker hands the four-slot caller a part of nine real requests and a remainder of one (its window is nine). The
part runs on a stretched grant and its calls back off together on one jitter draw. Likely causes are the stretched
grant's turnover under a jittered backoff and the draw per part rather than per request. Both need a closer look
alongside the managed-admission and blocking-call gaps.

Pinned: an `it.fails` with I1 and an exact pin (8,835 / 8,622).
