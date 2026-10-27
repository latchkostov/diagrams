## Nightly 2026-10-27: evidence and remaining work

Run [40465623922](https://github.com/latchkostov/diagrams/actions/runs/40465623922), workflow_dispatch at `ed765d464369863a5d37a903127720d534ee835c`. Fetched origin/master is that same commit. This includes #319, #343, #357 and Workbench #358; those earlier merges do not establish that a later observation is resolved. Work remains in this worktree; no simulation source changes.

## Findings and limits

- **K, fixed:** the edge inspector's live-details and Config-settings siblings used the same edge ID as their React key. Namespaced keys preserve both identities. A development React unit console guard and the existing Undo/edit/delete/settings/tutorial browser guards reject the old code.
- **R, fixed:** modal effect cleanup announced a close during StrictMode's replay, then recaptured focus inside the dialog. Retain the original opener and restore only after the panel leaves the document. The controller and direct-focus unit cases and the room dialog's dev regression cover it.
- **T/H, fixed tests:** timeline interception only named a production chunk; surface interception assumed TSX although carriedTypes is TS. Intercept the actual source and production chunk, and wait for the intercepted request. No timeout or assertion was weakened.
- **Z, fixed tests:** API requests imposed their 10-second action deadline on on-demand viewer building/compression. Download through the public install page, wait for browser download completion, and retain the offline unpack/playback assertions and existing whole-test backstops.
- **C, unresolved:** macOS had 31 admission/peer-discovery failures (missing knock controls or waiting for peers); the Windows production replay passes. No controlled macOS reproduction or proof of a particular transport fault exists. Capture socket/ICE/admission state on macOS; do not label this an engine counterexample or raise its timeout.
- **S, unresolved:** four macOS cases assume native closed-select ArrowDown/End+Tab changes selection as Windows does. Windows replays pass. Keep exact value and uncancelled-key assertions; verify the native interaction on macOS before changing choreography.
- **F/L/N/V/D/I, unresolved:** historical failures include hidden cards/edges, details focus, autosave reads, changing callouts, frame cadence, simulated-clock progress, and report readiness. All selected native identities pass the Windows production master replay (68 test executions); this neither proves their root cause nor erases the original failures. The dev Checks/import/Dock replays pass after warm-up; first dev navigation failures during simultaneous parity work are different errors, recorded below. Use controlled readiness/admission/measurement barriers before proposing fixes.
- **E, unresolved:** both Confluence framed-header tests fail waiting for host-embed-view on dev. A clean origin/master tracked-file snapshot reproduced all four executions (two variants × two repeats), each missing host-embed-view. Its trace confirms that production script-src blocks Vite's inline refresh preamble and connect-src blocks its HMR WebSocket. This is a dev/proxy configuration mismatch; the spec needs a production-header server even in the dev nightly lane. The snapshot shares installed dependencies and launches the same Vite CLI directly to avoid pnpm's workspace-location check; application and test sources are unchanged. Do not relax production CSP or skip the tests to hide the failure.

## Native unit and cancelled jobs

Both Native unit jobs were interrupted by the unchanged 15-minute Actions step limit. Windows finished unit with **13,059 passed, 0 failed, 10 skipped**, then was interrupted in heavy; macOS produced no complete unit report. There is no exact failing unit identity to invent from those reports. The Windows log summary is:

`SUMMARY: ed765d464369863a5d37a903127720d534ee835c | unit={"passed":13059,"failed":0,"skipped":10} parity="not run" e2e={"passed":0,"failed":0,"flaky":0,"skipped":0} gate_failures=2`

Random property tests were cancelled after `src/sim/waits.review.test.ts` reported **sampled callers preserve non-divisible pool capacity: generated scales for 1 slots** failing after 46,268 ms at ×20. Cancellation prevented the final failure/seed/path report: **no seed is available in this run**. This belongs to G1 in [the existing timeout triage](2026-10-25-timeout-triage.md), which measured finite work for an older known seed; that older seed must not be substituted for this missing one. Lane B owns any engine performance/counterexample investigation. No sampling or engine changes here.

Build ×3 1/6, 3/6, 5/6 and Dev server 1/4, 3/4 were cancelled, so their available failures are partial evidence, not successful whole shards. Native macOS E2E 1/8, 3/8, 7/8 and Windows 5/6 also have interrupted report markers; Windows 5/6 explicitly exhausted its 25-minute step. Preserve missing/incomplete results as unknown.

## A1 + A3 shard 7/16 — lane B

Job [122060194814](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194814) **succeeded: 630 passed** (313 A1 seeded cases, 313 A3 seeded cases plus regression cases). All 16 invariant jobs succeeded. There is **no failing seed, shrink path or engine counterexample** from shard 7/16 in the supplied run. The run already tests current master, so there is no failing seed to replay. The cancelled one-slot property above is separate from A1/A3.

## Every job

The paginated API returned 50 jobs; every macOS E2E shard failed. A group code links to the exact identities below. Successful jobs are listed so a partial first API page cannot be mistaken for the complete run.

| Job                                                                                                                                      | Result    | Failure groups / evidence    |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------- |
| [Random property tests (20x runs)](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194539)                    | cancelled | one-slot property; cancelled |
| [Engine determinism (Chromium, Firefox, WebKit)](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194729)      | success   | —                            |
| [A1 + A3 resource invariants (5000 seeds each) 15/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194792) | success   | —                            |
| [A1 + A3 resource invariants (5000 seeds each) 7/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194814)  | success   | —                            |
| [Native unit (windows-latest)](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194830)                        | failure   | unit step interruption       |
| [A1 + A3 resource invariants (5000 seeds each) 14/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194841) | success   | —                            |
| [Native unit (macos-latest)](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194851)                          | failure   | unit step interruption       |
| [A1 + A3 resource invariants (5000 seeds each) 12/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194854) | success   | —                            |
| [Collaboration network smoke (report only)](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194858)           | success   | —                            |
| [A1 + A3 resource invariants (5000 seeds each) 16/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194889) | success   | —                            |
| [Build ×3 6/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194898)                                        | success   | —                            |
| [A1 + A3 resource invariants (5000 seeds each) 11/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194910) | success   | —                            |
| [A1 + A3 resource invariants (5000 seeds each) 13/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194918) | success   | —                            |
| [Canvas gestures (Firefox, WebKit)](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194937)                   | success   | —                            |
| [A1 + A3 resource invariants (5000 seeds each) 8/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194939)  | success   | —                            |
| [Dev server 3/4](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194942)                                      | cancelled | K, V                         |
| [Dev server 4/4](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194949)                                      | failure   | E, H, K, T, Z                |
| [Dev server 2/4](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194970)                                      | failure   | D, K, R, Z                   |
| [Build ×3 1/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060194993)                                        | cancelled | I                            |
| [Skill viewer freshness](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195001)                              | success   | —                            |
| [Native E2E (windows-latest) 4/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195006)                     | failure   | L, V                         |
| [A1 + A3 resource invariants (5000 seeds each) 9/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195007)  | success   | —                            |
| [Native E2E (macos-latest) 8/8](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195034)                       | failure   | S                            |
| [Windows slow-motion teardown evidence (report only)](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195049) | success   | —                            |
| [Dev server 1/4](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195054)                                      | cancelled | I                            |
| [Build ×3 3/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195059)                                        | cancelled | incomplete                   |
| [A1 + A3 resource invariants (5000 seeds each) 10/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195070) | success   | —                            |
| [Native E2E (macos-latest) 3/8](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195078)                       | failure   | C, L                         |
| [Native E2E (macos-latest) 2/8](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195079)                       | failure   | F, N                         |
| [Native E2E (macos-latest) 7/8](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195084)                       | failure   | S                            |
| [Native E2E (macos-latest) 4/8](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195091)                       | failure   | C                            |
| [Build ×3 4/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195099)                                        | success   | —                            |
| [Native E2E (windows-latest) 1/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195111)                     | failure   | F                            |
| [Native E2E (windows-latest) 2/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195114)                     | failure   | F, V                         |
| [A1 + A3 resource invariants (5000 seeds each) 4/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195128)  | success   | —                            |
| [Build ×3 2/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195141)                                        | success   | —                            |
| [Native E2E (windows-latest) 3/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195174)                     | failure   | L, V                         |
| [Build ×3 5/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195179)                                        | cancelled | incomplete                   |
| [A1 + A3 resource invariants (5000 seeds each) 3/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195181)  | success   | —                            |
| [Native E2E (windows-latest) 6/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195205)                     | failure   | F, L                         |
| [Native E2E (windows-latest) 5/6](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195208)                     | failure   | L, V                         |
| [A1 + A3 resource invariants (5000 seeds each) 2/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195218)  | success   | —                            |
| [Native E2E (macos-latest) 5/8](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195224)                       | failure   | L                            |
| [A1 + A3 resource invariants (5000 seeds each) 1/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195273)  | success   | —                            |
| [A1 + A3 resource invariants (5000 seeds each) 6/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195283)  | success   | —                            |
| [A1 + A3 resource invariants (5000 seeds each) 5/16](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195340)  | success   | —                            |
| [Native E2E (macos-latest) 6/8](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195379)                       | failure   | C, N                         |
| [Native E2E (macos-latest) 1/8](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122060195736)                       | failure   | L                            |
| [Collaboration network smoke trend (report only)](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122061545697)     | success   | —                            |
| [Report failure](https://github.com/latchkostov/diagrams/actions/runs/40465623922/job/122077977054)                                      | success   | —                            |

## K: Config inspector keys

| Exact nightly identity                                                                                                                  | Jobs           | Current Windows check                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `tests/e2e/tutorials.spec.ts:403` — dependencies-2: Skip reveals hidden Dependencies                                                    | Dev server 3/4 | dev before harness corrections: passed                                |
| `tests/e2e/tutorials.spec.ts:403` — dependencies-2: Continue reveals hidden Dependencies                                                | Dev server 3/4 | dev before harness corrections: passed                                |
| `tests/e2e/tutorials.spec.ts:898` — dependencies-2: its solution plays through the real UI                                              | Dev server 3/4 | dev before harness corrections: passed                                |
| `tests/e2e/relationships.spec.ts:324` — Undo edit while Dependencies are hidden finishes focus recovery                                 | Dev server 4/4 | dev before harness corrections: passed; dev corrected harness: passed |
| `tests/e2e/relationships.spec.ts:324` — Undo delete while Dependencies are hidden finishes focus recovery                               | Dev server 4/4 | dev before harness corrections: passed; dev corrected harness: passed |
| `tests/e2e/relationships.spec.ts:364` — a config edge's settings show on hover and focus, with a lock on secrets                        | Dev server 4/4 | dev before harness corrections: passed                                |
| `tests/e2e/relationships.spec.ts:553` — settings paste stores names only and rejects oversized or nested JSON without changing settings | Dev server 4/4 | dev before harness corrections: passed                                |
| `tests/e2e/sim-clarity.spec.ts:108` — the owner's diagram: config carries nothing, and a topic nobody reads says so                     | Dev server 2/4 | dev before harness corrections: passed                                |

## T: Timeline interception

| Exact nightly identity                                                                                      | Jobs           | Current Windows check                                                 |
| ----------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `tests/e2e/live.spec.ts:841` — a held timeline chunk leaves Live controls usable until the timeline arrives | Dev server 4/4 | dev before harness corrections: passed; dev corrected harness: passed |

## H: Carried-types interception

| Exact nightly identity                                                                                  | Jobs           | Current Windows check                                                 |
| ------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `tests/e2e/lazy-surfaces.spec.ts:118` — edge.message-tip: held chunk, keyboard, export policy and Retry | Dev server 4/4 | dev before harness corrections: failed; dev corrected harness: passed |

## Z: On-demand skill ZIP

| Exact nightly identity                                                                             | Jobs           | Current Windows check                                                 |
| -------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `tests/e2e/skill-html.spec.ts:225` — the downloaded skill exports a file that plays offline        | Dev server 4/4 | dev before harness corrections: failed; dev corrected harness: passed |
| `tests/e2e/ai-howto.spec.ts:139` — Install the skill opens the install page with copyable commands | Dev server 2/4 | dev before harness corrections: failed; dev corrected harness: passed |

## R: Dialog opener / StrictMode

| Exact nightly identity                                                                                                     | Jobs           | Current Windows check                                                                               |
| -------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `tests/e2e/collab-room.spec.ts:593` — a room dialog restores focus; an unconfigured room chip explains setup without Retry | Dev server 2/4 | dev before harness corrections: failed; dev corrected harness: failed; dev corrected dialog: passed |

## C: Collaboration admission

| Exact nightly identity                                                                                                                                                       | Jobs               | Current Windows check             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------- |
| `tests/e2e/csp.spec.ts:325` — Edit together: two browsers meet through the approved trackers under the real policy                                                           | e2e-macos-latest-3 | Windows production master: passed |
| `tests/e2e/hosts-requests.spec.ts:83` — ask to drive, the host lets them: the new driver changes a rate and the old host follows by digest                                   | e2e-macos-latest-4 | Windows production master: passed |
| `tests/e2e/hosts-requests.spec.ts:130` — ask to drive, the host says not now: the asker is told, and goes on following                                                       | e2e-macos-latest-4 | Windows production master: passed |
| `tests/e2e/hosts-requests.spec.ts:160` — the host leaves on purpose: the earliest co-host becomes host, not whoever came first                                               | e2e-macos-latest-4 | Windows production master: passed |
| `tests/e2e/hosts-requests.spec.ts:190` — signed roles: new people can view only, a viewer's edit is undone, and Can edit lets them edit                                      | e2e-macos-latest-4 | Windows production master: passed |
| `tests/e2e/join-resilience.spec.ts:18` — a joiner gets the diagram though the host's presence frames are lost for a long while                                               | e2e-macos-latest-4 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:123` — two browsers start, join, edit both ways, reload and drop over an emulated tracker                                                     | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:396` — Clear everything stops the room's writers, an encryption started before it can't repopulate recovery, and an old link restores nothing | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:538` — a peer deleting the right-clicked node closes the menu (remote), the canvas takes the keyboard, the view stays                         | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:575` — joining hands the keyboard to the wait, then to the room's canvas, through the interaction controller                                  | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:803` — a peer that leaves shows Reconnecting…, then Everyone else left; a joiner nobody answers is told so                                    | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:858` — joining focuses the connecting status, then the canvas; focus moved to the toolbar stays there                                         | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:918` — remote boundary removal closes its context menu, and a selection menu holding a boundary                                               | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:982` — a Private paste whose Private mark fails reaches neither the peer nor the stored copy; its file copy is Private                        | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:1051` — a peer's selection and cursor show in their colour and name; the view and the keyboard stay yours                                     | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:1167` — others' outlines and pointers never show while presenting, printing or recording                                                      | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:1209` — an image export leaves out others' outlines, pointers and names                                                                       | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:1271` — P2 a peer deleting an edge announces why its menu closed                                                                              | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/collab-room.spec.ts:1297` — P2 peer deletion keeps rename canceled after the inspector loads                                                                      | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/knock-remove.spec.ts:49` — knock then admit: the newcomer waits at the door with nothing of the room, then the host lets them in                                  | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/knock-remove.spec.ts:84` — knock then deny: the newcomer is told, and leaves with nothing of the room                                                             | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/knock-remove.spec.ts:122` — with Ask before people join off, a newcomer is let in on their own: no card, nobody clicks                                            | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/knock-remove.spec.ts:151` — presenting: answering the last card from the keyboard leaves focus on the canvas                                                      | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/knock-remove.spec.ts:175` — remove: the room moves to a new key; the one removed is out, and the one who stays carries on                                         | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/watch-together.spec.ts:144` — a timeout edited mid-run reaches the follower through the shared run                                                                | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/watch-together.spec.ts:165` — the guest watches the host's Live: rps and replicas changed mid-run reach them on the same tick                                     | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/watch-together.spec.ts:195` — a late joiner catches up to the host's run and lands on the same state                                                              | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/watch-together.spec.ts:212` — the guest keeps following when the host restarts and picks another simulation                                                       | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/watch-together.spec.ts:243` — presenting (no top bar, no chip) stops neither the host sharing nor the guest following                                             | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/watch-together.spec.ts:271` — when the host's connection stops, the guest holds still and waits; no one else takes over                                           | e2e-macos-latest-6 | Windows production master: passed |
| `tests/e2e/watch-together.spec.ts:302` — the guest's camera is their own; Follow the host's view is opt-in and their own pan ends it                                         | e2e-macos-latest-6 | Windows production master: passed |

## S: macOS native select keys

| Exact nightly identity                                                                                              | Jobs               | Current Windows check             |
| ------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------- |
| `tests/e2e/requests-wait-checks.spec.ts:204` — thread expectation chips and metric picker work by keyboard in en    | e2e-macos-latest-7 | Windows production master: passed |
| `tests/e2e/requests-wait-checks.spec.ts:204` — thread expectation chips and metric picker work by keyboard in ar    | e2e-macos-latest-7 | Windows production master: passed |
| `tests/e2e/requests-wait-checks.spec.ts:204` — thread expectation chips and metric picker work by keyboard in en-XA | e2e-macos-latest-7 | Windows production master: passed |
| `tests/e2e/review-358.spec.ts:71` — R-caf692ac78 phone Speed retains native navigation keys                         | e2e-macos-latest-8 | Windows production master: passed |

## F: Visibility and detail focus

| Exact nightly identity                                                                                                            | Jobs                 | Current Windows check             |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------------- |
| `tests/e2e/planning-p1.spec.ts:348` — P1: live group details stay reachable in a short viewport                                   | e2e-macos-latest-2   | Windows production master: passed |
| `tests/e2e/private-diagrams.spec.ts:725` — Private P1 diagrams keep privacy through native, legacy and Interactive HTML downloads | e2e-macos-latest-2   | Windows production master: passed |
| `tests/e2e/imports.spec.ts:84` — Open… imports the compose fixture: nodes, boundaries, connections and the toast                  | e2e-windows-latest-1 | Windows production master: passed |
| `tests/e2e/imports.spec.ts:248` — privacy follows New diagrams are private; the report offers Make it private                     | e2e-windows-latest-1 | Windows production master: passed |
| `tests/e2e/network-devices.spec.ts:70` — a firewall's deny rule blocks traffic, counted apart from failures                       | e2e-windows-latest-1 | Windows production master: passed |
| `tests/e2e/smoke.spec.ts:20` — canvas: black-friday-commerce                                                                      | e2e-windows-latest-2 | Windows production master: passed |
| `tests/e2e/latency.spec.ts:215` — latency hover stays above the live bar at 1280×720 in embed                                     | e2e-windows-latest-6 | Windows production master: passed |

## V: Verification / Checks

| Exact nightly identity                                                                                                                                    | Jobs                 | Current Windows check                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------- |
| `tests/e2e/request-deadlines.spec.ts:195` — simulation-only traffic withholds an unverified timeout and applies the next confirmed fix                    | e2e-windows-latest-2 | Windows production master: passed      |
| `tests/e2e/lazy-live-fixes.spec.ts:208` — a failed trouble callout download offers Retry; Retry brings it and gives the keyboard back                     | e2e-windows-latest-3 | Windows production master: passed      |
| `tests/e2e/lazy-live-fixes.spec.ts:226` — a failed trouble callout keeps a persistent Retry through toast expiry and export, then brings the callout      | e2e-windows-latest-3 | Windows production master: passed      |
| `tests/e2e/requests-wait-owner.spec.ts:7` — the callout and planner offer the same verified fix; keyboard apply names its simulation and Undo restores it | e2e-windows-latest-4 | Windows production master: passed      |
| `tests/e2e/requests-wait-review.spec.ts:30` — a resumed narration still offers the same verified timeout                                                  | e2e-windows-latest-5 | Windows production master: passed      |
| `tests/e2e/requests-wait-review.spec.ts:110` — a held verification keeps one request outstanding and then posts only the latest revision                  | e2e-windows-latest-5 | Windows production master: passed      |
| `tests/e2e/requests-wait-checks.spec.ts:68` — Checks expose the verified primary fix and keyboard option chips in en                                      | Dev server 3/4       | dev before harness corrections: passed |
| `tests/e2e/requests-wait-checks.spec.ts:139` — an inspector alternative that removes two findings keeps keyboard focus in en                              | Dev server 3/4       | dev before harness corrections: passed |
| `tests/e2e/requests-wait-checks.spec.ts:112` — replica alternative replaces autoscaling with a fixed fleet in one undo step in ar                         | Dev server 3/4       | dev before harness corrections: passed |
| `tests/e2e/requests-wait-checks.spec.ts:68` — Checks expose the verified primary fix and keyboard option chips in en-XA                                   | Dev server 3/4       | dev before harness corrections: passed |
| `tests/e2e/requests-wait-checks.spec.ts:112` — replica alternative replaces autoscaling with a fixed fleet in one undo step in en-XA                      | Dev server 3/4       | dev before harness corrections: passed |

## D: Dock resizing

| Exact nightly identity                                                                                        | Jobs           | Current Windows check                                                 |
| ------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| `tests/e2e/collab-c0.spec.ts:259` — client panels and status stay within the Lab after widening the Inspector | Dev server 2/4 | dev before harness corrections: failed; dev corrected harness: passed |

## E: Framed dev embed

| Exact nightly identity                                                                                                                     | Jobs           | Current Windows check                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | -------------------------------------- |
| `tests/e2e/confluence-dc.spec.ts:30` — Confluence macro: attachment with saved simulations plays the first simulation under framed headers | Dev server 4/4 | dev before harness corrections: failed |
| `tests/e2e/confluence-dc.spec.ts:30` — Confluence macro: inline with saved simulations plays the first simulation under framed headers     | Dev server 4/4 | dev before harness corrections: failed |

## I: Import report readiness

| Exact nightly identity                                                                                                    | Jobs                         | Current Windows check                  |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------- |
| `tests/e2e/imports.spec.ts:170` — keyboard: focus stays in the report after an action, and a name hands focus to its node | Build ×3 1/6; Dev server 1/4 | dev before harness corrections: passed |
| `tests/e2e/imports.spec.ts:109` — the report opens from Details, lists the guesses, and a chip fixes one (undoably)       | Dev server 1/4               | dev before harness corrections: passed |

## N: Naming handover

| Exact nightly identity                                                                                                               | Jobs               | Current Windows check             |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------------- |
| `tests/e2e/naming-handover.spec.ts:91` — buffered quick-add: clicking another node saves before measurement and never reopens naming | e2e-macos-latest-2 | Windows production master: passed |
| `tests/e2e/trim3.spec.ts:6` — held node settings preserve quick-add naming, completion and one-step undo                             | e2e-macos-latest-6 | Windows production master: passed |

## L: Playback, camera, persistence and runner progress

| Exact nightly identity                                                                                                          | Jobs                 | Current Windows check                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------- |
| `tests/e2e/edge-shaping.spec.ts:176` — Control drag preserves an off-grid position while an unmodified drag snaps               | e2e-macos-latest-1   | Windows production master: passed                                    |
| `tests/e2e/requests-wait.spec.ts:105` — older diagrams preview changed capacity, upgrade once and undo the complete model       | e2e-macos-latest-3   | Windows production master: passed                                    |
| `tests/e2e/annotations.spec.ts:901` — inline auto-growth and inspector text stay within persistence limits on reload            | e2e-macos-latest-5   | Windows production master: passed                                    |
| `tests/e2e/drawing-basics.spec.ts:625` — live view still pans with a drag on the canvas                                         | e2e-macos-latest-5   | Windows production master: passed                                    |
| `tests/e2e/host-embed.spec.ts:228` — the host page supplies the diagram: it renders, plays, takes commands and reports back     | e2e-windows-latest-3 | Windows production master: passed                                    |
| `tests/e2e/live-render.spec.ts:363` — the worker path draws nothing on the main thread and runs no endless animation while live | e2e-windows-latest-3 | Windows production master: passed                                    |
| `tests/e2e/showcase-examples.spec.ts:546` — ev-charging-network: “deny rule stops” brings its cards into view                   | e2e-windows-latest-3 | Windows production master: passed; Windows production master: passed |
| `tests/e2e/lazy-loading.spec.ts:102` — a waiting narration keeps its Continue action after its download                         | e2e-windows-latest-4 | Windows production master: passed                                    |
| `tests/e2e/live.spec.ts:319` — Start a storm here creates a simulation that persists across reload                              | e2e-windows-latest-4 | Windows production master: passed                                    |
| `tests/e2e/lab.spec.ts:67` — every preset renders without errors (part 2 of 8)                                                  | e2e-windows-latest-5 | Windows production master: passed                                    |
| `tests/e2e/tutorials.spec.ts:363` — faults: Restore completes with an additional slowdown (menu)                                | e2e-windows-latest-5 | Windows production master: passed                                    |
| `tests/e2e/tutorials.spec.ts:363` — faults: Restore completes with an additional slowdown (Skip)                                | e2e-windows-latest-5 | Windows production master: passed                                    |
| `tests/e2e/tutorials.spec.ts:486` — webhooks: Skip continues the paused note so watching finishes expect-parked                 | e2e-windows-latest-5 | Windows production master: passed                                    |
| `tests/e2e/tutorials.spec.ts:898` — outbox: its solution plays through the real UI                                              | e2e-windows-latest-5 | Windows production master: passed                                    |
| `tests/e2e/tutorials.spec.ts:898` — partitions: its solution plays through the real UI                                          | e2e-windows-latest-5 | Windows production master: passed                                    |
| `tests/e2e/tutorials.spec.ts:898` — trace-slowmo: its solution plays through the real UI                                        | e2e-windows-latest-5 | Windows production master: passed                                    |
| `tests/e2e/skill-html.spec.ts:154` — playback checks preserve the viewer's existing animation-clock origin                      | e2e-windows-latest-6 | Windows production master: passed                                    |

## Validation notes

The six-worker, six-CPU Linux neighbourhood run passed its first four repeats (**147/147** each).
The fifth reported **141 passed, 6 failed** after an overlapping host production check rebuilt the
same `tests/.output/e2e-dist` being served by the bind-mounted gate. The trace for “canvas Tab visits
annotation links before the next node” records **HTTP 404 for the app document itself**. This is
verification interference introduced during this investigation, not evidence of a new product flake.
The six failed annotation cases alone passed twice on the clean-master snapshot (**12/12**).
The isolated replacement repeat is recorded below; no other build runs alongside it.

The replacement passed **147/147**, with zero failures, flakes or skips. Together with the four
uncontaminated repeats, this provides five passing executions of the affected tests and their
annotation/drawing/polish/viewport/platform/inspector neighbours at six workers and six CPUs.
The final browser-download helper also passed both selected dev tests, including cold archive
generation followed by offline export/playback. It observes the download event and completion
under the existing whole-test backstop; the click itself does not wait for server-side compression.

Isolated replacement summary:

`SUMMARY: ed765d464369863a5d37a903127720d534ee835c | unit="not run" parity="not run" e2e={"passed":147,"failed":0,"flaky":0,"skipped":0} gate_failures=0`

Contaminated-run summary (retained, not relabelled successful):

`SUMMARY: ed765d464369863a5d37a903127720d534ee835c | unit="not run" parity="not run" e2e={"passed":729,"failed":6,"flaky":0,"skipped":0} gate_failures=1`

Clean-master annotation-only summary:

`SUMMARY: ed765d464369863a5d37a903127720d534ee835c | unit="not run" parity="not run" e2e={"passed":12,"failed":0,"flaky":0,"skipped":0} gate_failures=0`

The clean-master Confluence probe ran only the two failed cases with `--repeat-each=2` and one
worker: **4 failed**, all at the same missing `host-embed-view` readiness assertion. The same two
cases against the production build passed **2/2**. The clean snapshot's trace records the blocked
inline refresh preamble and HMR socket; production CSP is unchanged.

The initial selected dev replay reported **7 failed, 22 passed**: three cold page navigations (install/dock/room), both Confluence variants, the carried-types hold and skill ZIP. The cold navigation errors differ from the nightly signatures. The corrected focused harness run reported **7 passed, 1 failed**, isolating room focus; after its product fix that dev case passed. The initial baseline Undo and timeline tests were **3 failed, 1 passed**, with duplicate keys and the unheld timeline; these failures are not masked by production React.

The new unit guards pass **3/3**. A temporary Vite test transform restored the old key and modal logic without modifying source during the Linux load gate: **2 failed, 1 passed**, confirming both regressions detect their removed fixes.

Parity checked **3,178 goldens, 0 changed, 0 added, 0 missing, 0 stale** (1,873 Node tests and 110 Linux browser tests). No golden was re-recorded. Remaining observations are in tests/flakes.json with exact test titles and narrow error signatures; adding observations does not quarantine, retry or authorize incomplete jobs.
