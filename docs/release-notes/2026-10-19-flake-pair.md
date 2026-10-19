## Fault-style regression baseline

The cut/restore style test sometimes saved an edge's opacity during its initial fade
to Live's idle opacity (`0.4`). Restoring the link correctly returned to `0.4`, which
could never equal the saved intermediate value (CI captured `0.461367`). The test
now waits for the rendered idle opacity before saving its complete style baseline.
Stroke, dash and opacity equality after restoration remain exact.

## Reading-region keyboard scrolling

Chromium's native smooth ArrowDown scroll could deliver compositor scroll deltas
after the latency readout's instant Home handler. The readout then moved away from
zero again, even though focus and the diagram camera stayed unchanged. A Linux
event trace reproduced a Home followed by additional scroll events ending at 16.
ArrowUp and ArrowDown now use the same instant scrolling as Home, End and paging,
so consecutive keys cannot leave a native arrow animation running behind them.

## Regression checks

The reading-region regression also checks that the arrow key's native default is
prevented, and fails against the original production bundle. A temporary diagnostic
deliberately restarted and slowed the real idle CSS transition: omitting the new
baseline wait failed exact restored-style equality; restoring it passed. The
diagnostic changed neither production CSS nor the committed test's timing.

The original Linux load run reproduced the viewer failure 4 times in 50 runs;
both edge themes passed 50 natural runs, so the controlled fade supplied their
negative check. After the fixes, each edge theme and the viewer passed 200 runs
with zero failures: eight temporary copies per case across 25 gate repetitions,
eight workers on four CPUs, fresh browser contexts and no retries. The temporary
copies are not part of the change.

## Output parity

All 2,712 parity goldens match, with none changed, added, missing or stale.
Simulation, diagram layout and exported output are unchanged; the product change
affects only keyboard scrolling in Live details.
