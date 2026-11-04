## PR #433: quarantine one Dev export deadline

Only `lowzoom-chips`'s `@dev` SVG comparison at 25% then 100% is marked `test.fixme`, after three
fix rounds. Its 30-second deadline is unchanged. The 40% Dev case and all twelve production-build
cases remain enabled. The capture's unchanged bytes, approximately one-second capture cost,
overlapping Checks work and three remaining product options are recorded in
[the backlog](../backlog/2026-11-04-black-friday-dev-deadlines.md).

## Property-step measurements and fix

Nightly `41840422814`, job `126610237829`, exhausted its 20-minute property-step deadline.
Cache agreement had not finished; the other completed files took 2.481 seconds (pane policy),
34.784 seconds (partial dots) and 32.502 seconds (call failure rate).

Local measurements use Node 24.22.0 on Windows, `CI=true FC_SEED=20261104 FC_RUN_MULTIPLIER=20`,
with three workers for ordinary shards and one worker per agreement batch. These are local timings;
the dispatched branch Nightly will measure the new steps on CI. The five agreement batches ran
concurrently on a host exposing 32 logical CPUs.

| File in the original shard 2/4                | Before, test seconds |
| --------------------------------------------- | -------------------: |
| `src/sim/cacheAgreement.test.ts`              |              558.473 |
| `src/sim/resilience.invariants.heavy.test.ts` |               21.980 |
| `src/live/callFailureRate.test.tsx`           |                9.163 |
| `src/sim/partialDots.test.ts`                 |                9.124 |
| `src/canvas/camera/panePolicy.test.ts`        |                0.688 |

| Step                        | Wall seconds | Executed assertions |
| --------------------------- | -----------: | ------------------: |
| Original property shard 2/4 |      582.551 |               5,564 |
| New ordinary shard 2/4      |       57.364 |               1,353 |
| Agreement batch 0 and pins  |      164.382 |                 836 |
| Agreement batch 1           |      125.164 |                 819 |
| Agreement batch 2           |      132.727 |                 843 |
| Agreement batch 3           |       93.945 |                 887 |
| Agreement batch 4           |       95.045 |                 830 |

The ordinary files still use four Vitest file shards. Removing agreement redistributes
`ledger.commands.test.ts` into shard 2/4 (31.994 test seconds). That shard's other files took
22.447 seconds (resilience), 9.763 (call failure rate), 9.650 (partial dots) and 0.752 (pane policy).

Agreement runs separately in its five existing seed batches. Name filters keep every observation
with its aggregate assertion; batch zero also runs every pinned case. Comparing the JSON reports
against the original run confirms that all 4,215 agreement assertions execute exactly once across
the five steps, with no missing, extra or duplicate assertions. Filtered tests belong to the other
batches; they are not additional quarantines. The four existing expected-failure sampling cases
remain unchanged.

All generators, 20× counts, scales, TTLs, item ranges, seed counts, the 10,000-dot floor, 40-second
warm-up, 20-second observation windows and statistical bounds are unchanged. The aggregate sweep
still covers 100 scale-one, 100 scale-ten and 200 automatic-scale cases. No deadline increased.

Removing operation probes only for the expanded agreement run was also measured: the whole-file
run still took 406.29 seconds, insufficient headroom given the CI slowdown. That experiment was
rejected. Instrumentation and ordinary coverage configuration remain unchanged. Shortening the
simulation windows or changing the export engine, Checks scheduling or example traffic is unnecessary
for this workflow fix and would require separate behavioral review.

## Validation and output parity

The workflow regression passes and fails when the original workflow is temporarily restored.
The routing tests prove that agreement stays separate from the ordinary file shards and that
observations, aggregate bounds and pins have exactly one owner.

Linux production-build `lowzoom-chips`: 12 Chromium cases passed; Dev had one pass and the single
approved fixme. Zero failures or flakes. The quick gate reported:

```text
SUMMARY: 5b2d6d4996b3d05e6b21c8e8319f6df1552ce5a2 | unit="not run" parity="not run" e2e={"passed":13,"failed":0,"flaky":0,"skipped":1} gate_failures=0
```

Parity: 1,972 Node tests and 112 Linux browser tests passed; 3,207 Node and 135 browser goldens
were unchanged. No golden was re-recorded. The initial browser invocation used Chromium's blocked
port 6665 and failed navigation; the browser tier passed on port 6765 using the same build.
