## Follow-ups eleven: native Nightly evidence

Nightly 39137867503 ran master `21c17fe3` and recorded 13 Windows failures across nine specs.
Two production invocations on clean master `55852ba5` selected those exact 13 cases by their
current titles/lines, with four-core process affinity, three workers and zero retries. All
26 executions passed, with no skips or flaky cases. The baseline includes the later temp-folder
and diagnostic changes; these passes do not establish a cause for the original native failures.

Local Windows report: `tests/.output/g/rSN3Ubw`; Linux report: `tests/.output/g/rfZW5l5`.
Original artifacts: `nightly-native-e2e-windows-latest-2` through `-5` from that Nightly.

| Case at the Nightly revision                 | Original failure                                                               | Disposition                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `csp.spec.ts:128`                            | Exact `0:01` recording display was skipped; polling saw `0:02` through `0:06`. | Control the clock in the recording regression; retain the real worker, tab capture and encoder.                 |
| `record.spec.ts:385`                         | Recording metadata was `0:04` after the test observed `0:02`.                  | Control the clock through stopping and review; retain the duration and real WebM assertions.                    |
| `trace.spec.ts:286`                          | Whole-test backstop; ordinary menu/sequence actions consumed seconds.          | Unreproduced in both native rounds. Capture original-runner timings before changing engine or cleanup behavior. |
| `slowmo.spec.ts:196`                         | Test and context teardown exhausted their backstops.                           | Unreproduced in both rounds. No causal cleanup fix established.                                                 |
| `slowmo.spec.ts:239`                         | Whole-test backstop.                                                           | Unreproduced in both rounds.                                                                                    |
| `sim-truth.spec.ts:262`                      | Initial live navigation exceeded its backstop.                                 | Unreproduced in both rounds.                                                                                    |
| `sim-truth.spec.ts:294`                      | Trouble callout remained after Revive.                                         | Unreproduced in both rounds; preserve the zero-callout assertion.                                               |
| `showcase-examples.spec.ts:218` (now `:289`) | Phone Inputs exposure check.                                                   | Unreproduced in both rounds; preserve the hit-test assertion.                                                   |
| `autoscaling.spec.ts:314`                    | Viewport stability predicate.                                                  | Unreproduced in both rounds; preserve camera assertions.                                                        |
| `lazy-examples.spec.ts:268`, `:293`, `:318`  | Two Browse clicks and an initial live session stalled.                         | Unreproduced in both rounds; preserve navigation and URL assertions.                                            |
| `round7-polish.spec.ts:86`                   | Not every node was in the pane after the AI panel opened.                      | Unreproduced in both rounds; preserve fit assertions.                                                           |

The other eleven cases remain follow-ups for evidence on the small Windows runner. No new quarantine,
retry, test-timeout extension or assertion relaxation is added. The four older slow-motion teardown
quarantines remain governed by their existing report-only Nightly diagnostic job.
After the fixes, the inventory plus the entire live-view spec passed twice natively (90 executions,
zero failed, flaky or skipped; `tests/.output/g/rpKWuBX`). The actual opt-in diagnostic executed all
12 selected bodies with zero skips (`tests/.output/g/rq8Bc1M`).

## macOS artifact inventory

The same Nightly's native macOS reports contain four failures. This Windows host cannot establish
native macOS reproduction. The paused-follow camera case is already resolved by #170; see
[the existing resolution](2026-10-18-paused-follow-camera.md). The remaining three need native
runner evidence before a product change:

| Case                               | Artifact                                    | Original failure                                                                       |
| ---------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `round13-polish.spec.ts:76`        | `nightly-results-native-e2e-macos-latest-2` | The new node's name field stayed inactive after quick-add.                             |
| `annotations.spec.ts:254`          | `nightly-results-native-e2e-macos-latest-7` | After reload, height was `9238px` instead of persisted `20000px`.                      |
| `capacity.spec.ts:321`             | `nightly-results-native-e2e-macos-latest-7` | Immediate topology read after undo had no rendered edges instead of the original four. |
| `followups4-inspector.spec.ts:463` | `nightly-results-native-e2e-macos-latest-8` | Paused follow transform advanced during Inspector resize; fixed by #170.               |

## Clean-master summaries

Windows, exact 13-case inventory twice:

```text
SUMMARY: 55852ba510454b7aebc7ed0aef90f1fa96c2b433 | unit="not run" parity="not run" e2e={"passed":26,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Linux, complete checks UI, live view and recording-capture specs twice, four workers/two CPUs:

```text
SUMMARY: 55852ba510454b7aebc7ed0aef90f1fa96c2b433 | unit="not run" parity="not run" e2e={"passed":94,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
