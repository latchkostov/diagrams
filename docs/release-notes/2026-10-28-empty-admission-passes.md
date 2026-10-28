## Skip empty admission passes

An admission with no pending work, continuations or takeovers returns before writing the
re-entrancy flags or entering its pass. Admissions with work retain their existing phase order,
including callbacks during working-set compaction. No UI or simulation behavior changes.

The operation regression observes zero dirty-flag writes on empty up, paused and down nodes
under both legacy and waiting revisions. Active work still enters admission, drains and replays
identically from a checkpoint. Restoring the original engine makes both cases fail.

## Isolated measurement

At 500 pipeline parts, three processes with five samples each, before adding the broker cache:
steady playback 150.656 -> 145.531 ms (16.926 -> 16.455 cu), Run simulations
286.357 -> 274.371 ms (31.653 -> 30.733 cu), checkpointed replay
1,586.421 -> 1,534.986 ms (184.066 -> 178.167 cu). These are medians of process medians.
Run simulations improves 4.19% raw / 2.91% normalized; replay improves 3.24% raw / 3.21%
normalized. The small normalized admission-only improvement is not presented as a 5% win.
See the companion broker-bookkeeping fragment for the method and final combined comparison.

No simulation, parity or same-arrivals golden is changed or re-recorded.
