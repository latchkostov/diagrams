## Baseline and comparison

Newest master Nightly at task start: [41168472337](https://github.com/latchkostov/diagrams/actions/runs/41168472337), source `46aa6dc64`. It predates the merge of #397. Compare with its final branch [41167179188](https://github.com/latchkostov/diagrams/actions/runs/41167179188), source `f518038bb`. A newer observation is not by itself a regression; shard assignments changed. Root-cause labels below are observed boundaries until reproduction proves a mechanism.

| Run                | OS      | Green shards | Red shards | Passed | Failed | Existing skips | Unfinished |
| ------------------ | ------- | -----------: | ---------: | -----: | -----: | -------------: | ---------: |
| Master 41168472337 | windows |            2 |          6 |   2983 |     14 |             15 |          0 |
| Master 41168472337 | macos   |            3 |          9 |   2950 |     51 |             11 |          0 |
| Branch 41167179188 | windows |            1 |          7 |   2982 |     22 |             15 |          0 |
| Branch 41167179188 | macos   |            4 |          8 |   2950 |     42 |             11 |         16 |

## Current failed executions

“Both” means the same file/title failed in the previous run, independent of shard. All reported flakes are zero. No quarantine, retry, budget, tolerance or golden changes are part of this inventory.

| OS/shard         | Test                                                                                                                                                             | Group                   | Last two runs |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------- |
| macos-latest-1   | tutorials.spec.ts:946 — dependencies-2: its solution plays through the real UI                                                                                   | Readiness / replay      | Both          |
| macos-latest-1   | tutorials.spec.ts:946 — study-cells: its solution plays through the real UI                                                                                      | Readiness / replay      | Current only  |
| macos-latest-1   | tutorials.spec.ts:1812 — typed solution preserves text around the caret                                                                                          | Readiness / replay      | Current only  |
| macos-latest-10  | bundle-trim.spec.ts:177 — quick-add navigation picks before typing hands over to naming                                                                          | Deferred input          | Current only  |
| macos-latest-10  | collab-room.spec.ts:123 — two browsers start, join, edit both ways, reload and drop over an emulated tracker                                                     | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:417 — Clear everything stops the room's writers, an encryption started before it can't repopulate recovery, and an old link restores nothing | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:565 — a peer deleting the right-clicked node closes the menu (remote), the canvas takes the keyboard, the view stays                         | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:605 — joining hands the keyboard to the wait, then to the room's canvas, through the interaction controller                                  | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:833 — a peer that leaves shows Reconnecting…, then Everyone else left; a joiner nobody answers is told so                                    | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:888 — joining focuses the connecting status, then the canvas; focus moved to the toolbar stays there                                         | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:948 — remote boundary removal closes its context menu, and a selection menu holding a boundary                                               | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:1012 — a Private paste whose Private mark fails reaches neither the peer nor the stored copy; its file copy is Private                       | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:1081 — a peer's selection and cursor show in their colour and name; the view and the keyboard stay yours                                     | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:1197 — others' outlines and pointers never show while presenting, printing or recording                                                      | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:1239 — an image export leaves out others' outlines, pointers and names                                                                       | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:1301 — P2 a peer deleting an edge announces why its menu closed                                                                              | Peer admission          | Both          |
| macos-latest-10  | collab-room.spec.ts:1327 — P2 peer deletion keeps rename canceled after the inspector loads                                                                      | Peer admission          | Both          |
| macos-latest-10  | firstrun.spec.ts:79 — Start blank opens the stencil search; adding a node retires the card                                                                       | Deferred input          | Current only  |
| macos-latest-10  | firstrun.spec.ts:117 — File > New diagram starts a blank one and keeps the previous in Your diagrams                                                             | Deferred input          | Current only  |
| macos-latest-10  | hosts-requests.spec.ts:83 — ask to drive, the host lets them: the new driver changes a rate and the old host follows by digest                                   | Peer admission          | Both          |
| macos-latest-10  | hosts-requests.spec.ts:130 — ask to drive, the host says not now: the asker is told, and goes on following                                                       | Peer admission          | Both          |
| macos-latest-10  | hosts-requests.spec.ts:160 — the host leaves on purpose: the earliest co-host becomes host, not whoever came first                                               | Peer admission          | Both          |
| macos-latest-10  | hosts-requests.spec.ts:190 — signed roles: new people can view only, a viewer's edit is undone, and Can edit lets them edit                                      | Peer admission          | Both          |
| macos-latest-11  | annotations.spec.ts:673 — placement buffers annotation newlines and saves with ControlOrMeta+Enter                                                               | Deferred input          | Current only  |
| macos-latest-11  | csp.spec.ts:325 — Edit together: two browsers meet through the approved trackers under the real policy                                                           | Peer admission          | Both          |
| macos-latest-11  | join-resilience.spec.ts:18 — a joiner gets the diagram though the host's presence frames are lost for a long while                                               | Peer admission          | Both          |
| macos-latest-11  | lowzoom-chips.spec.ts:73 — chips publish a tier only after zoom settles and reuse it through pan                                                                 | Worker / recording      | Current only  |
| macos-latest-12  | latency.spec.ts:244 — overflowing latency details support pointer and keyboard scrolling in embed                                                                | Geometry / presentation | Current only  |
| macos-latest-12  | latency.spec.ts:244 — overflowing latency details support pointer and keyboard scrolling in presentation                                                         | Geometry / presentation | Both          |
| macos-latest-12  | sim-truth.spec.ts:123 — fields that can't change the run are hidden; a value already set says so                                                                 | Readiness / replay      | Both          |
| macos-latest-3   | capacity.spec.ts:326 — adding an entry point is one undoable topology edit                                                                                       | Geometry / presentation | Current only  |
| macos-latest-3   | edge-shaping.spec.ts:176 — Control drag preserves an off-grid position while an unmodified drag snaps                                                            | Geometry / presentation | Both          |
| macos-latest-4   | workbench-council.spec.ts:77 — council inspector note has an inset and the description hint does not truncate                                                    | Geometry / presentation | Both          |
| macos-latest-6   | requests-wait-checks.spec.ts:204 — thread expectation chips and metric picker work by keyboard in en                                                             | Native selects          | Both          |
| macos-latest-6   | requests-wait-checks.spec.ts:204 — thread expectation chips and metric picker work by keyboard in ar                                                             | Native selects          | Both          |
| macos-latest-6   | requests-wait-checks.spec.ts:204 — thread expectation chips and metric picker work by keyboard in en-XA                                                          | Native selects          | Both          |
| macos-latest-6   | review-358.spec.ts:71 — R-caf692ac78 phone Speed retains native navigation keys                                                                                  | Native selects          | Both          |
| macos-latest-6   | workbench-camera.spec.ts:23 — Follow frame, text floor and rendered contrast (retry, light)                                                                      | Geometry / presentation | Current only  |
| macos-latest-7   | watch-together.spec.ts:144 — a timeout edited mid-run reaches the follower through the shared run                                                                | Peer admission          | Both          |
| macos-latest-7   | watch-together.spec.ts:165 — the guest watches the host's Live: rps and replicas changed mid-run reach them on the same tick                                     | Peer admission          | Both          |
| macos-latest-7   | watch-together.spec.ts:195 — a late joiner catches up to the host's run and lands on the same state                                                              | Peer admission          | Both          |
| macos-latest-7   | watch-together.spec.ts:212 — the guest keeps following when the host restarts and picks another simulation                                                       | Peer admission          | Both          |
| macos-latest-7   | watch-together.spec.ts:243 — presenting (no top bar, no chip) stops neither the host sharing nor the guest following                                             | Peer admission          | Both          |
| macos-latest-7   | watch-together.spec.ts:271 — when the host's connection stops, the guest holds still and waits; no one else takes over                                           | Peer admission          | Both          |
| macos-latest-7   | watch-together.spec.ts:302 — the guest's camera is their own; Follow the host's view is opt-in and their own pan ends it                                         | Peer admission          | Both          |
| macos-latest-9   | knock-remove.spec.ts:49 — knock then admit: the newcomer waits at the door with nothing of the room, then the host lets them in                                  | Peer admission          | Both          |
| macos-latest-9   | knock-remove.spec.ts:84 — knock then deny: the newcomer is told, and leaves with nothing of the room                                                             | Peer admission          | Both          |
| macos-latest-9   | knock-remove.spec.ts:122 — with Ask before people join off, a newcomer is let in on their own: no card, nobody clicks                                            | Peer admission          | Both          |
| macos-latest-9   | knock-remove.spec.ts:151 — presenting: answering the last card from the keyboard leaves focus on the canvas                                                      | Peer admission          | Both          |
| macos-latest-9   | knock-remove.spec.ts:175 — remove: the room moves to a new key; the one removed is out, and the one who stays carries on                                         | Peer admission          | Both          |
| macos-latest-9   | relationships.spec.ts:626 — delimiter-bearing node IDs and labels stay one dependency in the hidden list                                                         | Geometry / presentation | Current only  |
| windows-latest-1 | tutorials.spec.ts:946 — backlog-lag: its solution plays through the real UI                                                                                      | Readiness / replay      | Both          |
| windows-latest-2 | round13-polish.spec.ts:284 — Shift box preserves a selected edge (1280px, sheet: default)                                                                        | Geometry / presentation | Current only  |
| windows-latest-2 | sim-truth.spec.ts:437 — loss callout adds a broker DLQ in one undo step and exhausted messages reach it                                                          | Readiness / replay      | Current only  |
| windows-latest-4 | imports.spec.ts:825 — Draw everything is compact: fitted, its cards are readable, not specks in a tall column                                                    | Geometry / presentation | Current only  |
| windows-latest-4 | requests-wait-review.spec.ts:110 — a held verification keeps one request outstanding and then posts only the latest revision                                     | Readiness / replay      | Current only  |
| windows-latest-6 | fit-settled.spec.ts:659 — the canvas mutation observer disconnects after an interrupted animated fit                                                             | Geometry / presentation | Current only  |
| windows-latest-6 | requests-wait-owner.spec.ts:7 — the callout and planner offer the same verified fix; keyboard apply names its simulation and Undo restores it                    | Readiness / replay      | Both          |
| windows-latest-6 | ux-resilience-followup.spec.ts:116 — timeline events form one roving keyboard stop and retain pointer access                                                     | Geometry / presentation | Current only  |
| windows-latest-7 | lazy-live-fixes.spec.ts:227 — a failed trouble callout keeps a persistent Retry through toast expiry and export, then brings the callout                         | Readiness / replay      | Both          |
| windows-latest-7 | viewer-bundle.spec.ts:31 — bundle: busy-thread autoscaling, readouts and a recorded replay                                                                       | Worker / recording      | Current only  |
| windows-latest-8 | live-render.spec.ts:366 — the worker path draws nothing on the main thread and runs no endless animation while live                                              | Worker / recording      | Current only  |
| windows-latest-8 | lowzoom-chips.spec.ts:129 — a troubled drill accents chips and rolls up zone health without animated canvases                                                    | Worker / recording      | Current only  |
| windows-latest-8 | lowzoom-chips.spec.ts:159 — low zoom stops painting during running playback: worker                                                                              | Worker / recording      | Both          |
| windows-latest-8 | trace.spec.ts:442 — traced labels never overlap each other or a node card, and tracing keeps the diagram's zoom                                                  | Worker / recording      | Current only  |

## Sixteen unfinished macOS results

Previous branch macOS shard 10 was terminated at the existing **25-minute step deadline**, not a reporter crash. Job [124437157587](https://github.com/latchkostov/diagrams/actions/runs/41167179188/job/124437157587) logs “The action … has timed out after 25 minutes.” Its atomic checkpoint records **219/235 completed: 206 passed, 13 failed**, leaving **16 unfinished**. They are neither passes nor intentional skips. The checkpoint originally persisted only completed identities; counts could expose the gap but could not name the unfinished cases.

The reporter now checkpoints the complete discovered inventory before execution, and tracks started cases. Collection preserves unfinished identities even beside a final partial JSON. Failure summaries label each unfinished case as running or not started, separate from assertion failures and skips. No deadline is increased and no test is removed.

Regression: kill the reporter process after two completions with one running and one queued case. Original implementation: **1 failed, 21 passed**; repaired implementation plus final-JSON lifecycle coverage: **23 passed**. Windows native, Node 24.22.0. Raw evidence stays ignored under `tests/.output/native-n2/`.
