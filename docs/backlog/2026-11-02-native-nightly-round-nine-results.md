## Final dispatched inventory

Ready PR [421](https://github.com/latchkostov/diagrams/pull/421) contains separate signed fixes for
Inspector focus ownership, annotation height preservation, authored-time Continue playback and complete
timing inputs for browser-shard allocation. Nightly
[41413744689](https://github.com/latchkostov/diagrams/actions/runs/41413744689) tests
2c2033fe1e7a0ac2b64a623835cb0d8561e543a2 with every E2E case enabled as before.

| OS / mode      | Passed | Failed | Existing skips | Unfinished |
| -------------- | -----: | -----: | -------------: | ---------: |
| Windows        |  3,326 |     14 |             15 |          0 |
| macOS          |  3,336 |      4 |             11 |          4 |
| Linux Dev      |  3,305 |      0 |             50 |          0 |
| Linux Build x3 | 10,032 |      0 |             33 |          0 |

Every report has zero flakes and reporter errors. Dev and Build each complete the entire 3,355-case
inventory (Build three times). The first dispatch's 22 unfinished Build executions remain recorded in
the shard-balance fragment; the redistributed workload passes under the unchanged limits.

Both native platforms also complete 15,653 unit/heavy cases each, with zero failures or unfinished
cases and 13 existing skips each. The original Lab case, controlled focus regression, study-rag Continue
and annotation reload all pass on Windows, macOS, Dev and every Build repetition. Full PR CI passes
this tested head. These observations do not claim that every native flake is repaired.

## Native failures still enabled

Windows has four failed shards and fourteen failed cases, grouped by observed stage rather than an
assumed shared cause:

- Capture / browser commands: `live-record-capture.spec.ts:339` cannot reach recording readiness on
  the main path; `:362` stalls while opening the worker-path caption scenario. Both are recurring groups.
- Live / room readiness: `live-large.spec.ts:183` hits its whole-test limit and `:235` misses Live
  controls; `live.spec.ts:34` misses the presenting note. `watch-together.spec.ts:144`, `:165` and `:195`
  miss their edge-settings, watch-offer or capacity controls. The late-join and large-view groups recur.
- Replay / keyboard: `tutorials.spec.ts:626` stays at survive-psp-brownout; the dead-letters keyboard
  solution in `tutorials-keyboard.spec.ts:38` cannot reach its destination. Brownout also fails in the
  first dispatch; retain actual simulation and focus state before changing the driver.
- Readout / paint observations: `pools-busy-threads.spec.ts:66` misses the scaling disclosure,
  `live-render.spec.ts:36` misses the canvas paint-mode report, `sim-truth.spec.ts:439` misses its DLQ
  action, and `trace.spec.ts:442` observes one traced label where it expects at least two. The planner
  disclosure recurs; the other exact cases are observations, not established flake rates.

macOS fails the study-payments, load-shedding and api-gateway keyboard solutions in
`tutorials-keyboard-5.spec.ts:6`, `tutorials-keyboard-6.spec.ts:6` and `tutorials-keyboard.spec.ts:38`.
Study-payments leaves quick-add open after command navigation; load-shedding misses queue details;
api-gateway stays at add-orders. These belong to the recurring keyboard/focus groups.

`latency.spec.ts:384` presentation Home stops at 39 px instead of zero, recurring from the earlier
30 px branch observation and the round-8 scroll group. Its exact assertion remains unchanged.
The protected edge-navigation camera rule and `lowzoom-review.spec.ts:52` are untouched.

## Four interrupted native cases

macOS shard 7 exhausts its existing workflow step with 281 of 285 executions complete. Its four
unfinished cases remain enabled:

- `checks-simulations.spec.ts:489`: long-run typing responsiveness (running).
- `collab-room-relay-sharing.spec.ts:6`: relay sharing (not started).
- `checks-simulations.spec.ts:276`: StrictMode Checks mount from Ctrl+K (not started).
- `checks-simulations.spec.ts:276`: StrictMode Checks mount from canvas right-click (not started).

No budget, assertion, tolerance, retry or quarantine is changed. The first dispatch's AI Undo,
Properties and copy-notice/control-presence observations remain investigations even when a later run
passes. The copy-notice test fails in 2.36 seconds, so the ordinary six-second expiry is not its cause.
The reported tutorial flushSync warning remains unproven locally; the synthetic badge experiment is
rejected because the real loader uses an asynchronous import continuation.

## Upstream integration after the Nightly

Master advances to f7efa7dcd37f88281f127d8848befae01b6dc7fd (#422) while the dispatched runs finish.
Only the generated viewer conflicts. A signed upstream merge preserves the published commit history;
`pnpm regen` rebuilds that asset from both parents instead of choosing either binary. No parity golden
requires resolution. The table above records the tested pre-integration head, not an assumed Nightly
result for the merge. The requested Linux integration gate exits busy (75) before running any checks:
another worktree holds eight of twelve slots and this cohort requests six. No live lock is removed,
no capacity wait is extended and no Linux integration pass is claimed. Regeneration and i18n check
complete with zero errors. A serial Node cohort passes all 159 tests covering editor/read-only
compatibility, coach placement, focus, annotation and shard behavior before the final lint, typecheck
and formatting sequence; the signed merge is pushed for
CI verification under the busy-gate rule. The prior completed gates and Nightly above remain distinct
from this integration check.
