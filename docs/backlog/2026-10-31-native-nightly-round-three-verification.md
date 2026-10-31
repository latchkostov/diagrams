## Changes and regression evidence

Native select drivers use printable typeahead on macOS, including trusted Unicode character events and a unique label prefix for action selects that reset after activation. Windows and Linux retain their arrow-key and popup paths. Exact value assertions remain. The native-select diagnostic is unchanged.

The snapping hints show Command on macOS and Control elsewhere. The macOS native run below passes Command-drag's exact off-grid assertion, the existing Meta case, and actual Control-click secondary-menu coverage. Its English, Arabic and pseudo-localized metrics-select cases also pass.

Two product-state repairs have direct regressions: local copy drags keep one Undo transaction across the merge window, and a delayed routing-field mount cannot consume a newer edit request. Their temporary reversions fail the added tests. Release notes and UX reviews accompany both repairs and the platform hints.

Driver repairs acknowledge focus ownership, tutorial completion, scheduled-note simulation time, Lab observation readiness, current autosave, native scroll completion, activated drag coordinates, search results, viewer-template responses and download events. Each has a failing temporary reversion or recorded before/after reproduction. The Default-row driver settles input focus before the same pointer click; a real scroll correction at pointer-down reproduces the macOS trace's missed click when reverted. Its native macOS confirmation is pending.

Every keyboard lesson remains registered exactly once across four measured files. The completeness unit covers the canonical lesson list, including lessons added by synchronization. The two existing keyboard exclusions, `boundaries` and `arrange`, are preserved. Linux action deadlines now retain atomic checkpoint JSON through the workflow's outer collection step; the wiring and killed-process behavior have targeted units.

## Local verification

Node 24.22.0, native Windows Chromium and the pinned Linux Playwright container, with explicit ports and declared workers/CPUs. The final application-code gate includes the relevant units, bundle reserve tests, production build, size checks, full parity and two Linux drawing-precision repetitions:

```text
SUMMARY: 7a6f1eedb5a1b4bfa880bbf32ba402ca7341a54f | unit={"passed":311,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":28,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The earlier complete routing/platform/viewport Linux cohort passed 54 executions, with 32 targeted units, size/build checks and all 3,178 goldens unchanged. Subsequent changes affect browser drivers and documentation. Additional final-source cohorts pass:

| Cohort                                                                  |             Windows |                                            Linux production |
| ----------------------------------------------------------------------- | ------------------: | ----------------------------------------------------------: |
| Merged keyboard regressions, real slow-motion lesson, annotation search |                  13 |                                         26, two repetitions |
| Held viewer template and skill/app export comparison                    |                   2 |                                          4, two repetitions |
| Download-event observation and full offline export                      |                   2 |                                          4, two repetitions |
| Default-row focus and complete route-edit/Undo case                     |                   2 |                                          4, two repetitions |
| Current-save reader and complete planning upgrade/Undo case             |                   2 |                                          4, two repetitions |
| Nine remaining native tutorial failures                                 | 18, two repetitions | Covered by the earlier full lesson cohorts where applicable |

The complete tutorial-port and latency specs also pass two Linux repetitions under six workers/six CPUs. Shared capacity became available within the normal one-minute acquisition; no live lock was removed:

```text
SUMMARY: 932184d0dcd6f8698ba2a1a1c2a5c6c768a04368 | unit="not run" parity="not run" e2e={"passed":64,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

All 14 drawing-precision Windows cases pass. Tracked-source Linux Dev reproduced the original drag failure 1/10, passed 10/10 with acknowledged drag origins, and failed 1/20 after temporary reversion. Latency's three affected Windows cases pass five repetitions. The initial full Linux keyboard cohort had 118 passes and two scheduled-note regression failures; bounded fake-clock frame jumps repaired those failures, with five subsequent note-regression passes and repeated complete Webhooks lessons. The final merged keyboard cohort above also passes the scheduled-note regression twice on Linux.

Final lint, typecheck, repository-wide format checks and i18n checks pass. Lint reports 11 existing warnings and zero errors; i18n reports zero errors. An initial gate command used an unsupported `--unit` option and ran no checks; the corrected targeted gate above passed. An initial observation-unit selector found no file, and a new test's `void` generic annotation failed lint; both were corrected before their commits. Expected failing reversions are regression evidence, not green runs. No full gate or full suite was queued in this fix round.

## Output parity

Exactly two committed goldens change intentionally:

- `node/i18n/catalogs.json`: one new platform free-drag message, one English fallback in each translated catalog, and the resulting shortcuts-area hashes. The generated pseudo catalog retains zero fallbacks; its edge/shortcuts hashes reflect the two existing hints now interpolating the modifier.
- `browser/selection/corpus-hand-shaped-lines.json`: three handle-title strings become `Ctrl: no snapping` on Linux. Geometry is unchanged.

The release note `2026-10-31-platform-snap-modifier.md` records both changes. Full output parity reports zero further differences. Generated assets were refreshed through `pnpm regen` and synchronization; the plugin version is unchanged.

## Completed native evidence

Task baseline: [round-two final Nightly 41220274105](https://github.com/latchkostov/diagrams/actions/runs/41220274105). The newest master Nightly remains [41168472337](https://github.com/latchkostov/diagrams/actions/runs/41168472337), source `46aa6dc6465e018e8e284d5e33f2aca6a40cdd0d`; there is no newer completed master comparison.

The latest completed branch run is [41237930234](https://github.com/latchkostov/diagrams/actions/runs/41237930234), source `44357db5e11766df10fd70cbe1bc79f8b0fb5ef3`. It includes both macOS decisions, Unicode selects and the initial history/focus repairs. It predates the later frame stepping, keyboard split, Lab readiness, scrolling, checkpoint, routing-ownership, persistence and geometry repairs. It is red and does not verify the final branch. All reported flakes are zero.

| OS/mode                        | Passed | Failed | Existing skips | Unfinished |
| ------------------------------ | -----: | -----: | -------------: | ---------: |
| Windows                        |   3077 |     28 |             15 |         57 |
| macOS                          |   3135 |     10 |             11 |         21 |
| Linux Dev                      |   3122 |      5 |             50 |          0 |
| Linux Build, three repetitions |   9493 |      5 |             33 |          0 |

The final ready PR links a new Nightly dispatch and its tested SHA. Until that run completes, the following groups remain native observations requiring confirmation:

- Windows: eight keyboard failures and the oversized shard's 57 unfinished cases; nine pointer-tutorial readiness/replay failures (18 local repetitions now pass); camera/narration, request-deadline callout, shared-run input, scaling inspector, held image export and firewall selection; recording pixels/captions and worker frame throughput.
- macOS: four keyboard lessons plus the note regression and 21 unfinished cases; `study-cells` replay; Default-row input/scroll geometry and planning-upgrade persistence (new scoped repairs); small-diagram fades and narrated call-pill bounds.
- Linux Dev: four tutorial-port publication/cancellation cases and the scheduled-note regression, with local repairs verified by targeted repeats.
- Linux Build: three scheduled-note regression executions, now repaired locally; two `lowzoom-chips` image-export `@dev` executions that exceeded their unchanged test deadline.

These observations are not declared proven clean-master failures. Unreproduced rendering, geometry and worker assertions remain enabled. No new skip, quarantine, retry, timeout, tolerance or budget increase was introduced. Renderer/style changes and broad readiness sleeps were rejected because the available evidence did not establish those causes. Each implementation cause was signed and pushed separately after synchronization; no PR is merged by this work.
