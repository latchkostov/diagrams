## Native load backstops

Owner: latchkostov, Cadence #2 (`test/deterministic-ci`).

Operation counts replace CPU-sensitive complexity measurements. Long simulation sweeps,
public-example evidence and ZIP determinism move out of covered parallel units. CI runs static
checks, three coverage shards, build/size/ZIP and serial heavy tests independently. No assertion,
timeout, workload, sample count or bundle budget is relaxed.

Remaining work belongs to the later e2e-clock PR: replace time-based readiness in slow motion,
lazy chunks, inspector/annotation interaction and export completion with explicit state signals.
Investigate native teardown and download cancellation independently of capacity starvation.
Keep unconfirmed failures unconfirmed; an isolated passing rerun does not establish a pre-existing
bug. Track repeated failures in `tests/flakes.json`; local contention alone does not qualify.

## Kubernetes volume replay under native load

The 2,000-document volume/replay case also crossed its unchanged 5-second native backstop during
the Istanbul checks and after moving to uncovered heavy. Its test token stream and workload are
unchanged; the reader's operation-count guard remains in unit. Only this case was replayed twice
on clean current master `2c6a463c`: first `Tests 1 failed | 54 skipped (55)` with the same
`Test timed out in 5000ms`, then `Tests 1 passed | 54 skipped (55)`. This confirms the native
backstop can fail independently of this change, and does not establish an assertion regression.
Moving it avoids covered-unit cost; it does not claim to fix load starvation. No ledger entry or
timeout increase was added, and the #263 exclusions remain intact.

## Ledger evidence

Seeded from the Follow-ups 10 queue on 2026-10-23. Counts are documented observations, not a
reconstructed total across all CI history. Three Windows slow-motion teardown quarantines remain;
the fourth title was modified by #263 and is deliberately excluded, along with Kubernetes
linearity and the lazy-live trouble toast. Earlier reports identify checks typing (two Linux jobs,
Nightly 39137867503), library duplicate toast (39182643860), recording pixels,
dark restored styles and viewer scrolling (39253686172). Sampling bursts were reported in five
runs; ZIP determinism timed out twice including after #263. Their new heavy paths are recorded.

The ledger grants no permission to merge. The classifier fails closed for unknown test titles,
missing reports, cancelled jobs and setup/build/upload failures. Reviewers must still distinguish
an assertion regression from a recorded timeout in the same test.

## Consolidated load evidence

These 45 overlapping fragments are replaced by this investigation. Immutable links retain every
command, clean-master comparison, exact SUMMARY line and uncertainty in the original reports.
Unconfirmed failures remain unconfirmed; consolidation does not declare a product issue fixed.
New capacity observations belong in PR reports and CI artifacts.

## Cadence native confirmation

The initial native heavy run under concurrent coverage hit six existing five-second backstops:
sampled resource callers at 500 CPU-ms, refined scaling peaks, retry-storm evidence, retry-storm
seed 7, and the busy-thread/pool no-op comparisons. Only those cases were replayed twice against
an untouched `origin/master` archive at `d8850ec5`, inside this worktree, with one worker and the
same installed dependencies. All six reproduced: `Test Files 5 failed | 5 passed (10)`;
`Tests 6 failed | 60 passed | 158 skipped (224)`; no type errors. No full clean-master suite ran.
No timeout, sample count or assertion was relaxed. The serial CI lane uses the existing CI
backstop and removes coverage contention; native isolation cost remains an open follow-up here.

| Original evidence                                                                                                                                                               | Investigation                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [2026-10-20-annotation-load-verification.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-20-annotation-load-verification.md)                     | Annotation regressions observed during Forge verification          |
| [2026-10-20-deadline-gate-browser-followups.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-20-deadline-gate-browser-followups.md)               | Unconfirmed browser failures during deadline verification          |
| [2026-10-20-deadline-windows-sync-timeout.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-20-deadline-windows-sync-timeout.md)                   | Unconfirmed Windows sync-test timeout during deadline verification |
| [2026-10-20-followups-fourteen-evidence-timeout.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-20-followups-fourteen-evidence-timeout.md)       | Public-example evidence timeout under concurrent verification      |
| [2026-10-20-linux-export-storage-timeouts.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-20-linux-export-storage-timeouts.md)                   | Linux full-gate browser failures                                   |
| [2026-10-20-r4-full-gate-browser-startup.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-20-r4-full-gate-browser-startup.md)                     | Full-gate browser failures observed during the R4 review           |
| [2026-10-20-verification-load-timeouts.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-20-verification-load-timeouts.md)                         | Investigate long-note and evidence test load sensitivity           |
| [2026-10-20-windows-verification-timeouts.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-20-windows-verification-timeouts.md)                   | Windows verification under concurrent load                         |
| [2026-10-21-export-fallback-download-cancellations.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-21-export-fallback-download-cancellations.md) | Export fallback downloads stalled during one full Linux gate       |
| [2026-10-21-public-example-unit-timeout.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-21-public-example-unit-timeout.md)                       | Public-example simulation unit timeout under verification load     |
| [2026-10-21-requests-wait-full-gate-controls.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-21-requests-wait-full-gate-controls.md)             | Full-run download and slow-motion failures                         |
| [2026-10-22-annotation-load-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-22-annotation-load-backstops.md)                           | Annotation persistence and menu tests under CPU contention         |
| [2026-10-22-heavy-resilience-sweep-backstop.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-22-heavy-resilience-sweep-backstop.md)               | Heavy resilience sweep reaches the existing hang backstop          |
| [2026-10-22-linux-copy-and-slow-motion-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-22-linux-copy-and-slow-motion-load.md)               | Unreproduced failures under Linux browser load                     |
| [2026-10-22-native-lab-full-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-22-native-lab-full-load.md)                                     | Unreproduced native Lab failures under full browser load           |
| [2026-10-22-unit-backstops-under-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-22-unit-backstops-under-load.md)                           | Default unit-test backstops under concurrent browser load          |
| [2026-10-22-unit-timeouts-under-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-22-unit-timeouts-under-load.md)                             | Existing unit timeout backstops under shared load                  |
| [2026-10-23-broad-linux-load-followups.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-broad-linux-load-followups.md)                         | Additional results from the broad #255 Linux verification          |
| [2026-10-23-canvas-headroom-unit-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-canvas-headroom-unit-backstops.md)                 | Native simulation test backstops under concurrent load             |
| [2026-10-23-checks-growth-under-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-checks-growth-under-load.md)                             | Checks growth ratio under a shared Linux CPU quota                 |
| [2026-10-23-checks-ignore-export-timeout.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-checks-ignore-export-timeout.md)                     | Checks ignore/export/import whole-test timeout                     |
| [2026-10-23-ci-recovery-load-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-ci-recovery-load-backstops.md)                         | Shared-load timeout evidence during PR 247 recovery                |
| [2026-10-23-edge-review-browser-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-edge-review-browser-load.md)                             | Annotation persistence test under extreme concurrent load          |
| [2026-10-23-edge-review-full-gate-observations.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-edge-review-full-gate-observations.md)         | Loaded full-gate observations                                      |
| [2026-10-23-edge-review-unit-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-edge-review-unit-load.md)                                   | Unit hang backstops during the line-editing review                 |
| [2026-10-23-full-gate-export-timeouts.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-full-gate-export-timeouts.md)                           | Export and privacy timeouts in the full load run                   |
| [2026-10-23-heavy-unit-hang-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-heavy-unit-hang-backstops.md)                           | Heavy simulation unit tests exceed local hang backstops            |
| [2026-10-23-hover-cold-chunk-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-hover-cold-chunk-load.md)                                   | Cold hover-frame downloads during Linux stress                     |
| [2026-10-23-inspector-load-timeout.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-inspector-load-timeout.md)                                 | Investigate the inspector test duration under parallel Linux load  |
| [2026-10-23-inspector-merge-unit-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-inspector-merge-unit-load.md)                           | Native unit backstops during the Inspector master merge            |
| [2026-10-23-inspector-neighbour-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-inspector-neighbour-load.md)                             | Inspector failures in the neighbouring load sweep                  |
| [2026-10-23-inspector-review-unit-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-inspector-review-unit-backstops.md)               | Native unit backstops during the Inspector review                  |
| [2026-10-23-line-editing-master-unit-timeouts.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-line-editing-master-unit-timeouts.md)           | Native unit timeouts while finishing line editing                  |
| [2026-10-23-local-simulation-test-timeouts.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-local-simulation-test-timeouts.md)                 | Local simulation test timeouts during concurrent verification      |
| [2026-10-23-message-picker-native-unit-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-message-picker-native-unit-load.md)               | Native unit backstops during hover-stacking verification           |
| [2026-10-23-native-unit-load-timeouts.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-native-unit-load-timeouts.md)                           | Native unit hang backstops under load                              |
| [2026-10-23-native-unit-timeouts.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-native-unit-timeouts.md)                                     | Native unit timeouts under shared load                             |
| [2026-10-23-resilience-merge-unit-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-resilience-merge-unit-load.md)                         | Native timeout backstops during the resilience merge               |
| [2026-10-23-resilience-review-unit-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-resilience-review-unit-backstops.md)             | Heavy unit hang backstops during #255 review fixes                 |
| [2026-10-23-shaped-export-unit-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-shaped-export-unit-backstops.md)                     | Unrelated simulation and checks backstops                          |
| [2026-10-23-simulation-test-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-simulation-test-backstops.md)                           | Simulation test backstops under shared CPU load                    |
| [2026-10-23-stencil-a11y-load.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-stencil-a11y-load.md)                                           | Stencil gallery accessibility scan under load                      |
| [2026-10-23-unit-simulation-load-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-unit-simulation-load-backstops.md)                 | Simulation unit backstops under shared load                        |
| [2026-10-23-ux-merge-verification-capacity.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-ux-merge-verification-capacity.md)                 | Complete broad verification of the PR #255 merge in CI             |
| [2026-10-23-vendor-ci-test-backstops.md](https://github.com/latchkostov/diagrams/blob/d8850ec5/docs/backlog/2026-10-23-vendor-ci-test-backstops.md)                             | Vendor CI follow-up: existing simulation backstops (2026-10-23)    |
