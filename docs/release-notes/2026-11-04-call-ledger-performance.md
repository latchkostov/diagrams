## Faster call and reservation bookkeeping

Work and ledger reservations allocate their lifecycle fields together. Calls, replies and retained CPU tails update the same object layout instead of repeatedly growing it. Checkpoint copies allocate those same layouts before restoring aliases. Empty credit maps also avoid encoding a credit key. Timing, random draws, reservation arithmetic and event ordering are unchanged.

On Node 24.22.0, repeated uncached Black Friday `planScaling` calls measured 602 ms before and 480 ms after (20% faster; median of nine samples after three warm-ups, with GC before each call). Both runs produced four plans, 11,248 ticks and 25,218 messages with the same result SHA-256. First calls measured 829 ms and 715 ms. The 500 ms target is met for warmed calls; initial worker startup remains higher.

A planner/topology-only optimization was rejected because setup accounts for less than 4% of the CPU profile. Combining outgoing-call passes and mutating branch copies was also rejected after its measurement regressed. The retained optimization is the shared lifecycle layout for work and reservations, including restored copies.

Parity passes all 3,342 goldens with 0 changed, added, missing or stale; no golden was recorded. All 288 engine digest tests pass across Chromium, Firefox and WebKit. The 20 simulation benchmark tests and their operation/complexity gates pass. A same-process, alternating before/after retry storm (10,000 calls, three attempts, nine measured samples) has unchanged snapshots: total restore plus step is 943 ms before and 932 ms after; its simulation step is 764 ms before and 710 ms after. Copying the wider records alone costs 176 ms before and 222 ms after, so preserving their layout during restore is required to avoid an overall regression.

The quarantined 25% then 100% Dev export case remains quarantined: removing its `test.fixme` temporarily gave 17 passes and 3 deadline failures across 20 repeats in the Linux Playwright image, three workers on four CPUs, with the existing 30-second deadline. The test file was restored unchanged. This improves engine work but does not fully resolve cold Dev page-load contention.

The full unit/heavy run and the independent 48-seed sweep are verified separately; detailed final counts are in the PR.
