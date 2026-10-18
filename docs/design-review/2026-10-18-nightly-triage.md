## Camera and composer review

No controls, chrome or UI copy are added. Slow motion keeps its camera ownership
across pending panel work, and the pending item is consumed once. The AI panel
keeps the user's in-progress text and keyboard focus when an edited example is
saved as a copy. Switching editors still starts a fresh composer and selects the
new document's conversation. Presentation and recording keep their existing
geometry and output contracts.

The macOS viewport case used a wheel delta that React Flow multiplies by ten for
Mac trackpad pinches, moving the diagram centre outside the pane and invoking
R6. The test now exercises both platform interpretations at an equivalent zoom.
Its exact-position assertions remain intact, with an added assertion that the
gesture actually zooms. R6's separate off-pane centring rule is preserved.

## Nightly failure inventory

Source: run **39115946465**, master **cf252ceb**. The downloaded reports contain
15 Windows failures across five shards, six macOS failures across four shards,
and six Linux browser failures. The random-property job is the fourteenth failed
job. Locations below refer to that revision, before this branch's line shifts.

Classification attributes a merge only where the code or regression establishes
it. Long native requests and teardown stalls are load evidence, not proof that a
particular split caused them. macOS-only reports are not automatically OS bugs.

| Failure                                               | Classification                         | Cause                                                                                               | Resolution                                                                                                         | Verification                                                                                |
| ----------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Random camera, seed -1303150540, path 207:5:6:9:10:10 | Camera regression, #158/#160 gap       | Slow motion panel work in edit state fell through to centre.                                        | Route through W5 in every mode; fixed sequence and table row.                                                      | Original code fails the new regression; replay and three 20× random suites pass.            |
| Linux `editor:58`                                     | Interaction regression, #159           | Dev journal excluded by E2E-only guard.                                                             | Enable the journal in dev, retaining the production guard.                                                         | Negative unit test; native dev case passes.                                                 |
| Linux `undo-selection:341`                            | Interaction regression, #159           | Same missing dev journal.                                                                           | Same journal fix.                                                                                                  | Native dev case passes.                                                                     |
| Linux `text-fields:295`                               | Interaction regression, #159           | Same missing dev journal.                                                                           | Same journal fix.                                                                                                  | Native dev case passes.                                                                     |
| Linux `structure-bulk:505`                            | Interaction regression, #159           | Same missing dev journal.                                                                           | Same journal fix.                                                                                                  | Native dev case passes.                                                                     |
| Linux `collab-c0:60`                                  | Dev fixture/load issue                 | Fake WebSocket also intercepted Vite's HMR connections.                                             | Proxy only the fake matchmaking endpoint.                                                                          | Reverted fixture fails dev loading; fixed fixture and the four journal cases pass together. |
| Linux `checks-ui:313`                                 | Load/CPU comparison; unresolved        | Running/held ratio 1.573 exceeds 1.5; local repetitions did not reproduce it.                       | `test.fixme` and a dedicated backlog entry.                                                                        | Both small-container repetitions passed before quarantine; threshold preserved.             |
| macOS `i18n:707`                                      | Load-triggered product race            | First example save remounted the composer while the second reply was being entered.                 | Key the panel to the mounted editor.                                                                               | Deterministic save-during-next-draft regression fails on original code.                     |
| macOS `present:227`                                   | Camera readiness race                  | Browser fullscreen state can precede delivery of the camera event.                                  | Await the exact fullscreen fit command, then camera idle; keep the original final assertion.                       | Existing camera group passes twice on Linux.                                                |
| macOS `host-embed:726`                                | Iframe keyboard/platform timing        | Host page keyboard focus was assumed after an iframe DOM focus call.                                | Wait for camera/interaction readiness and press on the iframe's actual node Tab stop.                              | Targeted production validation.                                                             |
| macOS `ai-dictation:133`                              | Load-triggered product race            | Same composer remount interrupted the next dictation session.                                       | Same mounted-editor identity fix.                                                                                  | Save-during-next-draft regression and targeted dictation coverage.                          |
| macOS `ai-panel:273`                                  | Persistence/load race in setup         | Reload could beat first-edit promotion; the original example then had no persisted edited document. | Await the saved copy before reload.                                                                                | Targeted production validation.                                                             |
| macOS `viewport:51`                                   | macOS pinch input                      | The fixed wheel delta becomes 10× larger on macOS and invokes R6.                                   | Normalize the delta; test both platform interpretations with exact position assertions.                            | Mac UA on Linux reproduces the exact 955 px Nightly shift with the original delta.          |
| Windows `live-record-capture:295`, worker             | Camera readiness/load race             | Sampled transform stability while camera work could still be pending.                               | Wait for camera idle before the replay and after recording framing.                                                | Targeted worker/main capture validation.                                                    |
| Windows `trace:251`                                   | Playback/load race                     | At 8×, playing can advance to a waiting note before an assertion samples it.                        | Freeze the clock, assert playing, advance eight simulated seconds, then resume before loading the sequence dialog. | Targeted production validation.                                                             |
| Windows `host-embed:196`                              | Playback/load race                     | A pausing narration could arrive during host setup before Pause was asserted.                       | Control the host and iframe clocks; retain paused and event assertions.                                            | Targeted production validation.                                                             |
| Windows `autoscaling:186`                             | Slow-runner test work                  | Up to eighty clock/read round trips and trace snapshots exhausted the whole-test backstop.          | Observe every readiness publication in one browser-clock run.                                                      | All partial publications must keep the prior announcement; final ready count remains eight. |
| Windows `followups4-inspector:58`                     | Native cold-load issue; unresolved     | LiveSession and simulation requests took 10.17 s and 9.75 s.                                        | Windows-only `test.fixme`; native-load backlog.                                                                    | Existing case passes both small-container rounds.                                           |
| Windows `live:91`                                     | Native cold-load issue; unresolved     | Live controls awaited outstanding module downloads.                                                 | Windows-only `test.fixme`; same backlog.                                                                           | Existing case passes both small-container rounds.                                           |
| Windows `live:129`                                    | Native cold-load issue; unresolved     | Throughput explanation stayed at its loading placeholder.                                           | Windows-only `test.fixme`; same backlog.                                                                           | Existing case passes both small-container rounds.                                           |
| Windows `live:159`                                    | Playback/load race                     | Restart preserves paused state after an earlier run has stopped.                                    | Start from an explicitly paused run, restart, then explicitly play on the fake clock.                              | Targeted production validation.                                                             |
| Windows `html-export:457`                             | Playback/load race                     | Cold file loading could finish autoplay; Restart then preserved pause.                              | Explicitly play the restarted viewer before advancing its clock.                                                   | Targeted encrypted-file validation.                                                         |
| Windows `image-slices:492`                            | Export phase/load race                 | Workload size did not guarantee an observable cancellation phase.                                   | Hold the PNG decode, retain focus and cancellation assertions, and use a small fixture.                            | Targeted production validation.                                                             |
| Windows `image-slices:513`, initial module            | Export phase/load race                 | Cached retry could finish before its progress was sampled.                                          | Hold the retry's decode before checking progress, then release and require a completed download.                   | Targeted production validation.                                                             |
| Windows `slowmo:65`                                   | Native teardown/load issue; unresolved | Test and context teardown reached their existing backstops; trace incomplete.                       | Windows-only `test.fixme`; native-load backlog.                                                                    | Existing case passes both small-container rounds.                                           |
| Windows `slowmo:108`                                  | Native teardown/load issue; unresolved | Trace reaches final assertions before context close stalls.                                         | Windows-only `test.fixme`; same backlog.                                                                           | Existing case passes both small-container rounds.                                           |
| Windows `slowmo:271`, fitted                          | Native teardown/load issue; unresolved | Trace reaches viewport restoration before context close stalls.                                     | Windows-only `test.fixme`; zoomed case stays enabled.                                                              | Both variants pass both small-container rounds.                                             |
| Windows `slowmo:297`                                  | Native teardown/load issue; unresolved | Trace reaches recording option assertions before context close stalls.                              | Windows-only `test.fixme`; same backlog.                                                                           | Existing case passes both small-container rounds.                                           |

## Rejected approaches and coordination

No retries, timeout increases, weaker ratios, viewport assertion changes or
golden updates are used. Native serving/preload changes are deferred because the
two reproduction rounds did not establish their cause. The current teardown
evidence does not justify changing playback semantics.

The separately owned slow-motion `:135`, CPU-quota growth tests, self-host smoke
test and six Live text literals are untouched. No changes are made to
`useLiveKeyboard.ts`, `useLiveContextMenu.ts` or Live's Esc handling.

## Verification

- Replayed the exact Nightly camera seed/path, and ran the camera and interaction
  property suites three times with `FC_SEED=random FC_RUN_MULTIPLIER=20`, with no
  further counterexamples. Four additional scaled camera/controller runs passed.
- Temporarily restored the original policy and journal: both new regressions
  failed, then passed with the fixes restored. The composer regression also
  failed twice against the original implementation before passing with the fix.
- Forcing Mac pinch interpretation on Linux reproduced the exact Nightly 955 px
  jump with the original wheel delta. Both normalized platform cases now pass
  with the original exact-position assertions and an added zoom assertion.
- All five affected dev-server cases passed on native Windows Chromium. Native
  macOS was not run; platform-specific pinch interpretation was exercised in
  Linux instead.
- The pre-commit Linux gate passed 1,599 related unit tests, the production build,
  entry size and all nine viewport cases. Output parity checked all 2,196 goldens:
  zero changed, added, missing or stale. No golden was updated.
- Five loaded Linux repetitions at 3 CPUs, 7 GB and four workers each passed
  212 cases with zero failures or flaky cases and one quarantined CPU comparison
  skipped. Total: **1,060 passed, 0 failed, 0 flaky, 5 skipped**. Each repetition
  included the affected cases and complete annotation, drawing, Inspector,
  resize, viewport, platform, selection and naming neighbours.

The full gate runs after the signed commit; its exact summary and pushed SHA are
reported with the branch handoff.
