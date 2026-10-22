## Sampled CPU placement versus scale-one packing

Found while measuring sampling PR 6 (CPU tails yield, then repay). The `blocking-call` example in free play runs at scale 10. Its caller completes 13,710 real requests in 60 s, against 11,854 for scale one fed the same arrival instants. That is 15.7% too fast, independent of the seed, because the diagram has no jitter.

The caller has four 1-core replicas with 16 threads each, and 5 ms of CPU per request. At scale one, `acquireReplica` fills a partly used replica first. A replica's 16 threads then start together and share its core, so each request's first CPU phase takes 81.6 ms on average. A sampled dot's CPU parts are spread over every eligible replica (`sampledParts(f, activeReplicas, …)`), so a dot's phase takes 30 to 40 ms.

Packing every dot onto one replica overshoots in the other direction:

- `blocking-call`: master 10,530; with whole-request tails yielding, 9,220;
- `scale-on-busy-threads`: 9,980 against 14,337.

The right placement lies between the two and needs its own design. Any change moves most sampled resource goldens.

The `blocking-call` free play is the measured case where whole-request tails must keep their fair share ahead of first waves. Release notes: [sampling CPU tails](../release-notes/2026-10-21-sampling-cpu-tails.md).

## I7 counterexample at scale 4 (pre-existing)

`I7: spaced logical outcomes are independent of ledger holds` in `src/sim/attempt.test.ts` fails on master 6082bfe552a409d218f57f655b61e33d944e6c17 and on sampling PR 6 alike. Replay it with `FC_SEED=1235471473 FC_PATH="99:2:5:4:4:0:0:0:0:3:0:1:2:2:2:0:0:0:0:0:0:0:0:0:0:1:1"`. The scenario is a resource-backed one-slot caller (51 ms CPU) with a one-connection blocking call and a one-connection non-blocking side call, at scale 4.

CI's fixed seed 20261018 does not reach it. A random-seed local run with `FC_RUN_MULTIPLIER=5` found it on the third try.
