## Cheaper broker and admission bookkeeping

Brokers maintain an integer count of messages waiting across their groups. Publishing and
returning a delivery increment it; taking a whole queued message decrements it. A partially
delivered remainder still counts as one waiting message. Empty brokers skip their group scans.
Reset clears the count, and checkpoints preserve it with the owning node. Scale changes need
no recount: this is queue membership, not sampled units. Delivery planning, weights, prefixes,
route order, random draws, failures, prefetch and acknowledgement stay unchanged.

The broker regression independently recounts group queues at every step through fan-out,
partial deliveries, failures/returns, broker and consumer outages, scale edits, reset, load and
checkpoint restore. It also counts empty-queue reads to reject idle scans. The companion
admission change skips its wrapper when all three admission queues are empty.

## Measurements at 500 parts

Windows, Ryzen 9 7950X, Node 24.22.0 through `fnm exec --using 24 --`; source baseline
`cccaf4ec04f7f3c0fad575a0b203b06d4986383f`. The existing Node Vitest benchmark harness runs
one fork, exposed GC, no coverage, `BENCH_SIZES=500 BENCH_FAMILIES=pipeline BENCH_MODE=full`.
Each arm has three fresh processes and five samples per metric. The table uses medians of
process medians, with raw and normalized medians computed separately. Calibration is the
average of each suite's 21-sample readings before/after. The workload fingerprint is `cf8fdfba`.

| Metric              | Before ms |  After ms | Before cu | After cu | Raw reduction | cu reduction |
| ------------------- | --------: | --------: | --------: | -------: | ------------: | -----------: |
| Steady playback     |   150.656 |   138.186 |    16.926 |   15.526 |         8.28% |        8.27% |
| Run simulations     |   286.357 |   259.318 |    31.653 |   29.245 |         9.44% |        7.61% |
| Checkpointed replay | 1,586.421 | 1,495.524 |   184.066 |  173.038 |         5.73% |        5.99% |

Run simulations includes both saved runs. Replay uses the bisect diagnosis's 360 s steady
scenario at Traffic x10, scale 5, with real checkpoint capture/restore: initialize at 60 s,
one untimed 15 s -> 60 s pair, then five measured pairs. The final full-snapshot SHA-256
matches across all nine baseline/admission/final processes. Relative to admission alone,
the broker cache reduces Run simulations another 5.49% raw / 4.84% normalized.

Inspector profiles use the existing 200 us sampling interval and twelve runs per scenario,
with warm-up/construction outside profiling. The diagnosis harness now also profiles
Run simulations (`ENGINE_DIAG_SCENARIO=checks`). Baseline self shares are 6.98% broker pull
and 6.01% pending admission in Run simulations, and 4.98% / 6.50% in steady playback.
Afterward broker pull is 0.64% of Run simulations and 0.51% of steady self time;
pending admission leaves both top-fifteen lists. Replay's pull/admission shares fall
from 3.97% / 5.55% to 2.37% / 2.12%. Sampling/inlining changes attribution, so the
unprofiled table above is the speed comparison.
Raw benchmark parts, profiles, replay hashes and comparisons stay in the ignored
`tests/.output/engine-bookkeeping/` directory. One baseline replay overlapped an exploratory
profile; its entire third baseline process pair was discarded and replaced before comparison.

## Rejected candidates and output parity

A single-route direct-delivery fast path avoided a room map, recipient arrays and repeated
unit reads, but added only about 2% to Run simulations over admission alone. It was removed
under the greater-than-3% rule. Per-consumer window caching would need invalidation for live
props, fleets, scale and occupancy; the integer membership cache avoids that risk. No optional
tick/step rewrite or checkpoint-retention change is included. The independent fc-sweep is
left to the orchestrator.

Every simulation, parity and same-arrivals golden remains unchanged: zero goldens are edited
or re-recorded. No budgets or reserves are increased. There is no new simulation feature or
showcase example.
