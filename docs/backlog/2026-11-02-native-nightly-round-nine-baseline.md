## Accepted baseline

Scheduled master Nightly [41388520472](https://github.com/latchkostov/diagrams/actions/runs/41388520472)
tests 5c22a5d42, before round 8. This branch starts at d0ac286b3, which includes round 8 (#419).
All eight Windows E2E jobs and macOS jobs 2, 7 and 8 fail. The complete downloaded JSON reports record:

| OS / mode      | Passed | Failed | Existing skips | Unfinished |
| -------------- | -----: | -----: | -------------: | ---------: |
| Windows        |  3,314 |     24 |             15 |          0 |
| macOS          |  3,337 |      5 |             11 |          0 |
| Linux Dev      |  3,303 |      0 |             50 |          0 |
| Linux Build x3 | 10,026 |      0 |             33 |          0 |

Every report has zero flakes and runner errors. These counts are baseline observations, not branch results.
The one-case inventory difference from round 8's dispatch is retained, not filled with an assumed pass.

## Native failure inventory, grouped before choosing repairs

Line numbers below identify the baseline reports. An apparent one-off means absent from the round-8
remaining-investigations notes; a single failure does not establish a flake rate or root cause.

- Persistence: macOS `annotations.spec.ts:910`, inline growth / Inspector text reloads at 9,238 rather
  than 20,000 px. Recurs in round 8. Prioritize as possible data loss.
- Readout and focus: Windows `latency.spec.ts:182` (Space), `:193` (pinned Tab order), `:355`
  (presentation hover), `:384` (embed hover and presentation Home); macOS `:384` (embed Home ends at
  5 px). Latency hover and Home scrolling recur by behavior in round 8.
- Tutorial replay and keyboard: Windows `tutorials-apply-present.spec.ts:204` (study-rag Continue),
  `tutorials-solutions.spec.ts:7` (saved-simulations misses the waiting step),
  `tutorials-solutions-4.spec.ts:7` (where-time-goes), `tutorials.spec.ts:572` (scale-to-zero's held
  cold-start note), `:2239` (author-a-simulation Continue at pause sees continue),
  `tutorials-keyboard-2.spec.ts:6` (route-by-address cannot reach Skip),
  `tutorials-keyboard-3.spec.ts:6` (kafka-topic retains e-2). macOS
  `tutorials-keyboard-6.spec.ts:6` (load-shedding cannot reach Simulation) and
  `tutorials-keyboard.spec.ts:38` (api-gateway). Study-rag, saved-simulations and keyboard/readout
  problems recur as groups; the other exact lesson failures remain observations.
- Live state / handoff: Windows `requests-wait-checks.spec.ts:183` (en-XA verified fix control focus),
  `requests-wait.spec.ts:249` (trouble fix / Undo), `watch-together.spec.ts:195` (late-join catch-up),
  `live-large.spec.ts:141` (Overview ready particle), `:183` (capacity close navigation),
  `showcase-examples.spec.ts:177` (mobile title card checks/Undo), and
  `toast-interaction.spec.ts:306` (Workbench flyout control). Waiting fixes and initial Live readiness
  recur as groups; establish product state before changing their drivers.
- Capture / setup / cumulative time: Windows `node-settings-loading.spec.ts:37` (PNG download),
  `collab-room-relay-sharing.spec.ts:6` (relayBuild setup), `drawing-basics.spec.ts:549`
  (Alt-drag boundingBox), `password-links.spec.ts:188` (overall deadline), and
  `fit-settled.spec.ts:659` (mutation-observer count). Relay setup and export cumulative work recur
  as groups; the exact latter three failures are absent from round 8's remaining list.
- Output: macOS `lowzoom-chips.spec.ts:256` (natural SVG at 25% / 100%, dev project). This is separate
  from the protected `lowzoom-review.spec.ts:52`; preserve both assertions and investigate before
  considering any output change.

Round 8 also reports AI Undo, camera selection, worker captions and HTML capture failures which do not
appear in this scheduled baseline. Their absence here is not evidence of a new repair on this branch.
The protected low-zoom review and keyboard edge-navigation camera rule are outside this task's edits.
