## Undo chip indexing: measured prototype did not meet the shipping threshold

The implementation attempt for survey 2 item 3 did **not** establish the required >10% improvement
in single-selection Undo. No application prototype is retained in the source tree. The 0.8–1.2 s
Undo saving remains an unproven estimate, not an achieved result.

### Measurements

Windows Chromium 156.0.8078.4, Node 24.22.0, the survey's production E2E builds, 1440 × 900,
2× main-thread CPU throttle, synthetic pipeline workloads. Each table entry has three fresh-context
samples. Values are medians in milliseconds, with sample ranges. Undo restores the dragged node's
original transform; both operations include two subsequent animation frames. These are observations,
not elapsed-time assertions.

| Operation             |         Before @500 |        Indexed @500 |           Before @1500 |          Indexed @1500 |
| --------------------- | ------------------: | ------------------: | ---------------------: | ---------------------: |
| Single-selection Undo | 752.5 (749.8–753.3) | 787.0 (759.4–899.2) | 2165.3 (2081.4–2629.2) | 2131.2 (2130.8–2197.0) |
| Drag release          | 296.5 (274.4–297.2) | 320.3 (309.0–324.0) |    936.0 (927.8–979.3) |    863.1 (814.2–950.4) |

The indexed column uses the refined index with the original synchronous placement and rounded zoom
cadence (`chip-after5.jsonl`). At 1500, median Undo improves 1.6% and release 7.8%; at 500 both regress.
Mean Undo at 1500 improves 6.1%, also below the threshold. Overlapping ranges and local host contention
limit causal claims. No heavy benchmark comparison was run alongside a gate or load repeat.

The prototype used a canvas-owned `SpatialGrid`, ResizeObserver border-box measurements, current node
and label transforms, mutation/font/scale invalidation, exact rectangle reads for nearby or unknown
geometry, and the original full-scan fallback for dense or unsupported cases. It retained LR/TB side
order and ignored boundaries/zones exactly as before. Observer pruning excluded pan transforms,
absolute handles, unchanged measurements and unrelated edge chrome.

A counted 1500-node/1500-label unit fixture required two obstacle rectangle reads over two placements,
with fewer than 24 spatial candidates. Reference comparisons covered all 16 side-occupancy combinations,
both directions and five zooms, including annotations and labels. The targeted unit group passed
43 tests. Six deliberate regressions were caught: full scanning, stale sizes, omitted labels, stale
scale, clearing measured nodes when labels remount, and stale label translations. These rejected
prototype tests and sources are preserved locally under `tests/.output/chip-rejected/`, not shipped.

### Why the read-count improvement was insufficient

In the separate named-build indexed Undo diagnostic, GrowChip's outer placement accumulated about
971 ms inclusive, including about 930 ms in the selected card's bounds reads. The indexed obstacle
placement itself accumulated about 40 ms. The trace contains two large style recalculations:
405 ms / 48,020 elements and 503 ms / 66,788 elements. Avoiding distant obstacle reads did not remove
these scene-wide recalculations. This is evidence against the measured prototype's performance,
not proof that no possible geometry index can meet the target.

Rejected experiments also included a measured-card clear-space proof, placement deferred by one or
two frames, and a diagnostic removal of the body-level `:has` tooltip rule. None established the
required Undo improvement. One deferred variant improved median release at 500 by 10.8%, but its
Undo improvement there was only 4.3%, Undo at 1500 regressed, and mean release at 500 improved only
8.8%. This does not justify changing first-frame affordance behavior. No wrapper shortcut, generic
session metadata cache, budget/reserve increase, relaxed assertion or golden update was retained.

### Reproduction and next decision

The opt-in survey helper now has `survey2 chip pipeline@500` and `@1500` cases. Build using
`node scripts/bench/build.mjs`, materialize workloads with the benchmark workload spec, then select
these cases with `SURVEY2=1 SURVEY2_CHIP=1`. `SURVEY2_CHIP=1` omits the unused shipped-startup preview;
Playwright owns the two benchmark servers. Use an explicit unused `BENCH_PORT` and three samples.
Do not change application sources between workload materialization and the run: the workload cache
hash includes application sources.

Local evidence is in `tests/.output/bench/survey2/chip-{before,after2,after3,after4,after5,after6}.jsonl`,
`chip-undo-1500.cpuprofile`, `chip-undo-1500.trace.json`, and the `tests/.output/chip-*.log` files.
Initial setup attempts failed for absent dependencies, an unused unbuilt startup preview, and changing
workload cache keys; corrected measurement invocations passed. All measurement servers stopped.

The next investigation needs to identify and coalesce the scene-wide style invalidations around
single-selection restoration while preserving first-frame geometry and handle readiness. The user
has been asked whether to broaden this task to that work or keep these findings only. Full parity,
Linux E2E repeats, size/reserve checks and a post-commit full gate have not been run for a shipping
optimization, because no optimization met the acceptance threshold. No goldens were edited.
