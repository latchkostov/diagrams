## Caller pools keep working at a fixed sampling scale

Sampled callers continue draining after timeline edits, live replica/concurrency decreases and
autoscaler downscales. Partial pools use fractional occupancy and a local completion clock: each
dot retains its real message count and consumes proportionally more residence time. Growing a
pool takes effect on the same clock. Nested callers account for downstream sampling delay once.
CPU residence is also charged once, including CPU-bound callers. Type-filtered requests that
leave only local work retain their execution ceiling and report that residence as work.
Managed callers reserve fractional concurrency while charging quotas for the full real count.

Removed the global common-divisor refinement: coprime pools retain coarse sampling and continuous
traffic. Saved scales again agree with import validation. Scripted traffic also has a startup
preflight and a cumulative runtime bound, including multiplier changes and checkpoint replay.
Endpoint overrides now update the explanatory work duration, hold duration and wait ceiling.

## Output parity

The sampling correction changes only `node/sim/blocking-call/free-play.json`: its scale returns from
9.142857142857142 to 10. Its sampled counts, throughput, backlog, in-flight work and checkpoint
occupancy consequently reflect that fixed weight and fractional caller residence. No older
revision's golden changes. The existing public blocking-call example continues to demonstrate
the feature; no additional example or control is needed for this correction.

Syncing with master also regenerates `node/i18n/catalogs.json` for the combined upstream
documentation and collaboration-availability messages, with matching fallback counts and area
hashes. The shared `node/skill/public-schemas.json` conflict was regenerated for the combined
upstream documentation field and W1 schema. These are contract/catalog updates from the rebase;
no older revision's diagram output is re-recorded.

## Verification

Temporarily restoring the previous engine, runner and capacity implementation produced 15
expected regression failures, including both unsafe import volumes. The non-divisible-pool
property keeps the requested scale and compares sustained throughput to scale 1 within 1%, with
one pool of whole dots allowed for completion rounding. It covers pools smaller than one dot.
Timeline, live edit, downscale, occupancy, checkpoint, coprime-pool, runtime budget and endpoint
readout regressions cover the corrected behavior.
Six CPU-residence and filtered-work regressions also fail when those adjustments are temporarily reverted.
