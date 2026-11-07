## Cache-aside review fixes (#439, round 1)

- R-58e232ce88: item leases keep waiters in insertion order, indexed by their
  fetch group. Cancelling a reader removes that group directly; settling an owner
  still walks surviving readers once.
- R-6c8d9b858f: Checks builds conditional calls from the compiled simulation
  topology. Reconnecting a database Request to a Shape leaves a decorative
  connection and no longer crashes capacity analysis.
- R-357751d613: each lookup weights its own traffic classes, request filters,
  methods and shares when calculating miss and fetch shares for waiting and pools.
  A cacheable reader cannot discount an uncached writer's database hold.
- R-fb022e44f1: stale refresh dispatches the complete conditional origin group.
  All required replies must succeed before filling; a slower sibling delays the
  fill, and either sibling failing prevents it.
- R-f56f5940e3: demand and waiting analysis share one compiled cache configuration,
  including rules supplied only by saved simulation setup.
- R-fdfe41981d: the automatic write-back hint and its accessible description appear
  only while the cache-aside condition is active.
- R-922d38380b: the named coalesced fetch-rate agreement regression compares Live
  with the planner's fetch share for both existing item populations and five seeds,
  retaining the 5% relative-error bound.
- R-f754d1ff7f: capacity analysis indexes edges and effective cache tables once and
  appends origin groups without repeatedly copying their accumulated contents.

## Regression evidence and output parity

Focused engine, property, planning, editor and Inspector checks pass (178 tests).
Restoring the old behavior, or reintroducing its rescan or miss-share calculation,
fails the corresponding regressions for all eight findings. Complexity checks use
the existing eightfold input increase and operation-count limit of 24.

Lease checkpoints measure 131,292 B, 104,175 B and 82,479 B at scales 1, 10 and 50,
below the unchanged 130 KiB bound. Existing public examples retain their stories.
Full parity passes 1,995 Node tests and 112 Linux browser tests: all 3,376 goldens
are unchanged, with none added, missing or stale. Budgets, reserves, agreement
tolerances and limits are unchanged.

A production-bundled, same-process comparison against the pre-review head
940cb92e8 alternates before/after order after eight warm-up pairs. Sixteen measured
pairs average 360.806 ms before and 337.670 ms after (medians 345.395 ms and
336.619 ms). Both retain four sizing runs, 11,253 ticks and 25,485 messages. These
shared-machine timings show no growth in Black Friday's Checks sizing work.

## Viewer fixture verification follow-up

The first complete Linux Build gate passed 16,644 unit/heavy tests and all parity
records, then finished with 3,434 browser cases passed, one failed and twelve
skipped. The failed Interactive HTML autoscaling fixture expected a scale-up after
1.5 seconds of setup. Two repeats of only its spec on clean master
c9eba9f728c96b4efd0f23ada20be3c0a5ada8b2 passed all thirty cases, so the failure is
not classified as pre-existing.

The fixture advanced that interval in two large frame jumps. A page resuming from
being hidden intentionally discards its first frame's gap, which could consume
most of the setup interval. Setup now primes ordinary frames before batching the
remainder of the same interval. Production playback, elapsed setup time, polling
limits and assertions are unchanged. A forced visibility-resume regression fails
all three built viewers with the old helper.

The repaired viewer fixture, cache-aside tests and all Inspector/viewport neighbours
pass five Linux repeats with six workers and six CPUs: 1,195 passed, zero failed,
zero flaky and zero skipped. The final engine and complete-gate results are reported
with the pushed commit.
