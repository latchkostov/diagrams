## Faster Live on large diagrams

Live retains off-screen readouts and their latest simulation state, but defers processor,
gateway, source, store and sink badge rendering until their cards approach the viewport.
Entering cards refresh synchronously with the camera transform, including while paused.
Brokers still observe every publication to preserve their decaying depth peak. Chips,
connection pills, camera policy and simulation accounting are unchanged. Image capture
synchronously refreshes every readout before measuring or cloning the drawing.

The existing viewport index loads on demand. Hover-only concurrency, device and consumer-group
preparation moves into the existing lazy details surface to fund the change within the fixed
Live reserve. No budget, reserve or golden is raised or rewritten. **Changed goldens: none.**

## Measurements

Windows Chromium 156, production E2E build, pipeline workload, 1440 × 900, main-thread CPU
throttle 2×, default renderer and free-play traffic. Three consecutive five-second samples
after the standard warm-up; traces run separately so sampling overhead does not affect these
numbers. Same worktree and host, sequential runs without a concurrent local gate. These are
report-only measurements, not timing assertions; the downward drift is visible in both runs.

| Nodes | Before, ms/frame          | After, ms/frame        | Median improvement |
| ----: | ------------------------- | ---------------------- | -----------------: |
|   500 | 20.739, 14.719, 13.630    | 10.746, 4.942, 3.510   |              66.4% |
| 1,500 | 209.768, 178.898, 144.394 | 40.034, 30.592, 12.074 |              82.9% |

Chrome trace breakdown, approximate ms/frame (separate five-second captures). JavaScript
categories use exclusive sampled stacks; browser phases use timeline durations. Worker
message handling includes dispatch/decoding, so it is an upper bound on decode alone.

| Work                                       | 500 before | 500 after | 1,500 before | 1,500 after |
| ------------------------------------------ | ---------: | --------: | -----------: | ----------: |
| Worker message handling                    |       0.06 |      0.05 |         0.07 |        0.05 |
| Decoration application, excluding chip ink |       0.68 |      0.55 |        13.34 |        3.13 |
| Chips and low-zoom ink                     |       0.19 |      0.18 |         3.97 |        0.99 |
| React render/commit work                   |       2.36 |      2.56 |        42.16 |        5.16 |
| Style recalculation                        |       2.93 |      2.69 |        22.09 |        5.54 |
| Layout                                     |       2.33 |      0.91 |        30.78 |        2.43 |
| Paint                                      |       1.80 |      1.43 |        13.77 |        3.35 |
| Engine work on the main thread             |       1.03 |      0.94 |        45.58 |       11.78 |

The cliff is a feedback loop: updating off-screen badge text dirties thousands of layout
objects and spends React commit work; the slower frame then advances more simulation time
and catches up more engine ticks. The trace moves from 25 to 114 frame callbacks over roughly
five seconds at 1,500 nodes. This change does not alter the engine.

Reproduce with `node scripts/bench/build.mjs <out>`, materialize the workloads using
`BENCH_OUT=<out> BENCH_SIZES=500,1500 pnpm bench:prepare`, then
`BENCH_OUT=<out> pnpm exec playwright test -c tests/bench/playwright.config.ts liveScale.bench.ts`.
Results and Chrome traces stay under the ignored benchmark output directory.

## Rejected approaches

Making already-hidden far-view badges `display: none` improved the measured large workload
by less than 10%, so that candidate was removed. Unmounting readouts was rejected because
it would remove their DOM and lose broker depth observations. Off-screen broker throttling
was left out to preserve those observations. Budgets, assertions and goldens stay fixed.

## Regression coverage

The badge comparator regression fails when the visibility fast path is temporarily removed.
A production-browser test holds the clock, changes an off-screen service's status, then pans
it into view and checks the current status in the first frame, without another UI publication.
Capture tests cover synchronous full refresh, nested captures and cleanup. Lazy detail tests
cover resolution of current processor settings.

## Validation

The full Live and canvas unit folders passed 3,345 tests with one skipped. Full parity passed
all 3,178 goldens and 110 Linux browser cases: zero changed, added, missing or stale goldens.
The production-browser Live large-diagram spec passed all six tests. The final Linux gate
results are recorded in the pull request.
