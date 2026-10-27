## Performance quick wins

Live icons and idle chips skip unchanged renders, while closed node badges compare their displayed
metrics. Open details always refresh. Each broker owns its immutable depth-scale observation; publishing
no longer copies a diagram-wide peaks Map. Idle Request edges also avoid allocating empty arrays.

Run charts read a bounded, read-only history ring and retain both series' minimum and maximum in each
pixel column, plus the endpoints. The selected observations, axes and accessible summary are cached by
history version, node, window and width. Brief spikes survive; playhead-only updates reuse the plot.
Unused full-history materialization helpers were replaced by the ring view, including the aggregate view.
Raw badge diagnostic attributes remain in E2E builds; production keeps the visible readouts and test IDs.

## Measurements

The production names-build render benchmark, at the existing 2× CPU throttle:

| Renders per second | pipeline@100 before → after | pipeline@500 before → after |
| ------------------ | --------------------------: | --------------------------: |
| Total              |             1,679.3 → 667.3 |             5,280.7 → 1,158 |
| NodeBadge          |                 733.3 → 594 |             2,500 → 1,103.7 |
| IdleChip           |                   491.3 → 0 |                1,618 → 16.7 |
| LiveIcon           |                   381.3 → 0 |                1,112.7 → 11 |

Publish frequency varied under shared-machine load: 7.3 → 7.3 commits/s at 100 nodes and 5 → 2.7
at 500. Renders per commit fell from 229 → 91 and 1,056.1 → 434.3 respectively. These readings
are report-only; no benchmark baseline or gate was relaxed.

## CI balance and locale budget

Refreshed timings from [CI run 40562568873](https://github.com/latchkostov/diagrams/actions/runs/40562568873)
cover every spec, including the previously unmeasured workbench specs. The showcase's 68 Chromium tests
retain their titles and assertions across feature/phone (31), story (18), and narration (19) files.
Their recorded test times are 198.0, 349.4 and 394.2 seconds. Durations were reassigned from the original
CI test records before running the repository updater; no timing estimates were invented.

The six-shard plan estimates 2,264–2,266 seconds of test time per shard. The old count fallback, evaluated
with the same refreshed measurements, ranges from 1,334–2,845 seconds. These are summed test durations,
not wall-clock job predictions.

The locale catalog gate allows 97,500 B gzip per chunk, about 1.5% above the current maximum: Greek at
95,987 B. Catalog loading and all existing budgets and reserves remain unchanged.

Production gzip measurements: entry 418 B, startup 158,850 B, canvas first view 374,307 B and Live's
additional static imports 131,559 B. The first Live view totals 505,866 B versus 505,914 B before
(−48 B); the canvas portion alone is 7 B larger. Both existing reserve checks pass.

## Validation and output parity

Regression checks cover spike/trough preservation, uneven time columns, ring wrap/reset, cache
invalidation, badge metric changes and locale budget rejection. Deliberate regressions fail those checks.
All 3,178 output goldens passed with zero changes, additions, missing or stale files. No golden was updated.
The targeted Linux E2E gate encountered shared worker capacity exhaustion and exited 75; CI must run it.
