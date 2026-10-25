## CI flake tail: dispositions and evidence

The [60-run snapshot](2026-10-24-ci-flake-report.md) includes cancelled jobs' already-emitted failures,
not just red workflow conclusions. Four test IDs occur twice. This is the investigation's repeated-offender
set; one-off failures are retained in the report rather than assumed to have the same cause.

## State-based waits

- `lazy-recording.spec.ts`: two failures, on two branches, both waiting for `record-review` after Stop.
  The indicator mounts before the native recorder starts two animation frames later. Reading a frame from
  the captured stream does not prove that the encoder has started. Observe the native recorder's `recording`
  state and a nonempty `dataavailable` event before sampling and stopping. The browser's real capture,
  encoder and encoded narration-pixel assertions remain intact.
- `health-current.spec.ts`: one failure with an Open breaker at simulated 1.1 s and no trouble callout.
  The clock was frozen as soon as the pill said Open, before the independently loaded detector/callout had
  published. Await the detector's evaluated module and subscription frames at simulated zero, so it keeps
  the complete loss baseline. Pause the simulation at Open and advance UI frames until the callout is
  visible, then resume recovery. Holding the simulation avoids advancing past its brief Open phase while
  a chunk loads. The subsequent announcement, recovery and past-timeout assertions remain intact.

## Repeated room-menu failures: product investigation

Two room tests each failed twice on `fix/p2-a11y-focus`: the dialog focus/Retry test and the joiner's
Retry/alert test. Evidence: [40142999205, cancelled after emitting failures](https://github.com/latchkostov/diagrams/actions/runs/40142999205)
and [40143706958](https://github.com/latchkostov/diagrams/actions/runs/40143706958).
Both fail in `roomAction()` looking for `room-retry`, after the test already observed the chip's
`data-state="failed"` and the visible menu. The host's saved snapshot shows an expanded
“Room: No collaboration servers” chip and a menu containing Copy room link and Leave room, with no Retry.
The product's `OpenChip` contract adds Retry when its room state is failed. Waiting longer for the same
item cannot establish why those two views disagree. Lane C must not change that product contract or
replace the Retry/focus assertions. Keep the evidence for the product owner; do not force a click or
add a sleep/retry. The ledger entries identify these exact failures, not every room failure.

## Already addressed or outside this sample

- Shortcuts focus: the two failing runs expected Privacy immediately after Close. Commit `f88b5443`
  already updates the Tab order for the intervening Tutorials link. Keep its keyboard and return-focus
  assertions; another wait cannot repair an obsolete expected order.
- Presentation fullscreen: its one sampled failure predates the current explicit camera-journal and
  camera-idle waits (`bb5f0605`). Keep them and the clipping assertions.
- Request deadline validation belongs to [#305](https://github.com/latchkostov/diagrams/pull/305);
  do not duplicate the other lane's edit.
- `fit-settled.spec.ts:26` and `text-fields.spec.ts:350` have no failure in this 60-run snapshot.
  The latter deliberately tests keys arriving before field focus; waiting for focus would remove its
  regression coverage. No speculative change or ledger entry without observed evidence.

## Shard measurements

Latest complete successful shard set: [40154781593](https://github.com/latchkostov/diagrams/actions/runs/40154781593),
SHA `cc0c05b3442923b3f769f32d6c65ccc1d2a0684b`. Wall seconds for shards 1–6:
956, 533, 883, 398, 821, 533; mean 687.3. Shards 1 and 3 are 139.1% and 128.5% of the mean.
The aggregate historical means alone obscure this imbalance. Its logs also report six missing estimates,
which force the balancer's file-count fallback.

Downloaded only that run's six `e2e-durations-*` artifacts and used
`node scripts/e2e-shard.mjs --update tests/.output/flake-durations-40154781593`.
The resulting complete 147-spec map enables measured balancing again; the six projected totals are
1,805–1,806 seconds of test work (not wall time). Actual post-change shard wall times still require CI.
No budgets, retries, assertion tolerances or product code changed. No output goldens changed.

## Regression proof

An uncontrolled reversion of both original waits passed 60/60 cases (20 each for the two recovered-health
themes and recording) on Linux with four workers. This bounded trial did not reproduce the historical
CI failures; it is not evidence that their causes were fixed.

Added controlled scheduling to the real browser cases: the callout download waits one UI frame after
the breaker publishes Open, and the recording clock holds the encoder's startup frames after the
countdown. With the state waits present, all three pass. Temporarily removing just those waits fails
**3/3**, at the same `trouble-callout` (light/dark) and `record-review` assertions seen in CI. The native
capture/encoder and final encoded-pixel checks still run. Removing the report parser's normalization
also fails its deduplication regression (1 failed, 2 passed); accepting line-reporter progress as a
failure fails that case too. Restoring the parser passes all three unit tests.

Final controlled load run, pinned `mcr.microsoft.com/playwright:v1.64.1-noble`, four workers and four
container CPUs, `--repeat-each 20 --retries=0`: **160 passed, 0 failed, 0 flaky, 0 skipped**. Health:
140/140 across its seven cases, including 20 light and 20 dark recovered-breaker cases. Recording:
20/20, including the encoded clip's narration pixels. The report, ledger and shard-planner unit checks
pass 37/37. An overlapping parity attempt was interrupted (exit 137) when the repeat container closed;
it did not complete and is excluded from passing validation. The dedicated gate then passed the
production build, size check and full parity: **3,151 goldens, 0 changed, 0 added, 0 missing, 0 stale**.
