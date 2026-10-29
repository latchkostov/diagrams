## Nightly deadlines: finish the unchanged workload

Native unit coverage and heavy tests now run independently in three file shards each, on both
Windows and macOS. Native E2E uses eight Windows and twelve macOS shards. Missing or invalid timings
estimate only the affected specs instead of silently replacing duration balancing with file counts.
Linux Nightly's twenty dev/build shards share four same-run production builds instead of rebuilding
both common profiles in every job. All tests, repetitions, assertions and existing step/job/test
backstops remain; no limits increase. No application, server, transport, tracker or UI changes.

## Measured evidence

Sources: [Oct 28](https://github.com/latchkostov/diagrams/actions/runs/40632507452),
[comparison](https://github.com/latchkostov/diagrams/actions/runs/40577899574), and completed lanes of
[the later run](https://github.com/latchkostov/diagrams/actions/runs/40809144162).
Raw job logs and downloaded JSON reports stay in ignored `tests/.output/nightly-d/`.

| Lane                  | Comparison run       | Oct 28               | Evidence                                                      |
| --------------------- | -------------------- | -------------------- | ------------------------------------------------------------- |
| Windows unit job      | 16.7 min, incomplete | 16.6 min, incomplete | Coverage alone 869.0 / 814.8 s; heavy shares the 900 s step   |
| macOS unit job        | 16.5 min, incomplete | 11.8 min, complete   | Oct 28 coverage 276.3 s; heavy 381.1 s                        |
| Windows E2E, six jobs | 133.5 runner-min     | 121.3 runner-min     | Oct 28 shards 1 and 6 interrupted at 25 min                   |
| macOS E2E, eight jobs | 188.0 runner-min     | 201.0 runner-min     | Oct 28 shards 2, 4 and 7 interrupted at 25 min                |
| Build x3, twelve jobs | 246.8 runner-min     | 247.1 runner-min     | Oct 28 shard 7: 1,032 tests selected, no final JSON at 30 min |

Oct 28 group D totals **597.8 runner-minutes**, including incomplete work. The comparison totals
601.5. These are unweighted execution minutes from job start/end, excluding queue time and other
Nightly groups, not billing estimates or complete-suite costs.

Oct 28 step breakdown (seconds):

| Job             | Toolchain | Chromium cache |             Test/action step | Native report upload |
| --------------- | --------: | -------------: | ---------------------------: | -------------------: |
| Windows unit    |        54 |              9 |               900 (deadline) |                    3 |
| macOS unit      |        24 |              4 |                          662 |                    2 |
| Windows E2E 1/6 |        51 |             10 | 1,504 (deadline/termination) |                    6 |
| macOS E2E 4/8   |        50 |             11 | 1,513 (deadline/termination) |                    5 |

Linux Build x3 7/12 spends 1,813 s in its composite action, including 1,744 s in
Playwright before cancellation. Setup/builds consume about 69 s, while the incomplete browser work
consumes the rest. Artifact uploads are seconds on these native jobs, not the deadline bottleneck.

The later run's Windows coverage completes in 493.1 s and heavy in 354.4 s: 847.5 s combined, only
52.5 s below the step deadline. It is already green on that revision; splitting provides margin,
rather than claiming that a deadline happens on every run. Its other jobs were still active when
this baseline snapshot was taken.

Windows coverage's slowest Oct 28 files are `collab/knock.test.ts` (272.9 s),
`tutorials/completionSweep.test.ts` (105.4 s), `sim/examples.test.ts` (73.9 s),
`live/controlLog.test.ts` (56.5 s) and `examples/largeShowcases.test.ts` (54.5 s).
The same macOS files take 86.9, 38.5, 22.9, 16.8 and 18.0 s. Vitest attributes 80% of Windows's
810.9 s to tests, 10% to imports and 8% to transforms; macOS reports 77%, 9% and 11% respectively.
The dominant macOS heavy files, including beforeAll builds, are autoscaling invariants (56.7 s),
offline build (47.5 s), skill (47.4 s), deployment build (47.0 s), scale equivalence (37.4 s),
examples checks (25.6 s) and bundle split/reserve (22.7 s). Windows's first heavy file, skill,
consumes 74.1 s of its remaining 82.8 s; the interrupted run cannot measure later files.
The later Windows heavy run completes all files in 353.5 s, with autoscaling 49.8 s,
skill 45.3 s, deployment 45.3 s and offline 44.3 s.

Completed E2E test-time lower bounds from Oct 28 reports are **18,465 s Windows**, **10,887 s macOS**
and **35,498 s Linux Build x3** (one Linux report absent). Windows is dominated by tutorials
(1,188.5 s, only 67 completed tests), showcase narration (662.9 s), i18n (632.5 s), Lab (631.5 s)
and showcase stories (593.2 s). macOS is dominated by stories (406.7 s), showcase examples (404.1 s),
tutorials (391.3 s, only 57 completed), narration (387.3 s), rooms (362.6 s) and layout (360.6 s).
Linux's completed three-repeat leaders are stories (1,542.6 s), i18n (1,391.2 s), layout (1,331.4 s)
and narration (1,178.3 s). These totals include failed-test execution; partial reports undercount.

macOS has 3 CPUs / 7 GiB and one auto worker; Windows has 4 CPUs / 16 GiB and three workers;
Linux browser shards use three. macOS's individual i18n/layout test totals are actually lower than
Linux's single-repeat equivalents: fewer workers, incomplete work and unbalanced bins explain the
wall-time pressure without claiming slower macOS Chromium. Native build steps are tens of seconds
(Oct 28 Windows common builds 33-34 s in parallel; macOS 33 + 28 s serial), not the missing tens of
minutes. There is no per-operation filesystem/font/browser-start profile in these artifacts, so
none is claimed as a proven OS-specific code cause.

## Distribution and cost

Both old runs explicitly log a count-split fallback (21 missing timings in the comparison, five
on Oct 28). The 30-minute Build x3 deadline leaves 1,744 s for browser work after setup; the selected
shard keeps producing passing dots until cancellation. This is excess assigned work, not evidence
that a single assertion or browser teardown needs a larger timeout.

The shared timing map is refreshed from Oct 28's eleven completed production-repeat JSON reports,
averaging successful first attempts. Uncovered files retain their earlier measurements; ten current
files still use the mean estimate. No interrupted run is treated as a complete timing sample.
With this map, old count assignment versus greedy duration assignment projects:

| Shards | Count split min-max test-seconds | Duration split min-max |
| ------ | -------------------------------- | ---------------------- |
| 6      | 1,981-3,453                      | 2,415-2,416            |
| 8      | 1,160-2,573                      | 1,810-1,813            |
| 12     | 716-2,048                        | 1,206-1,211            |

These are scheduling weights, not promised native wall times. Eight/twelve native shards allow
unfinished tests and observed platform failures within the unchanged 25-minute steps. The Linux
build suite retains twelve shards and three repetitions. The common profiles previously cost forty
build invocations plus conditional variants; now all twenty shards consume just four builds.
Native sharding adds sixteen job setups (plus the shared Linux producer); shared Linux builds remove repeated bundling to offset
that overhead. Actual after-run minutes and completion/error status are reported in the PR.

## Verification and rejected approaches

The three targeted infrastructure specs pass 40 tests. Restoring the old planner fails the new
measured-weight regression; restoring the old workflow fails both new distribution/build regressions.
No assertions were weakened to preserve an old count-split expectation: the existing count fallback
cases remain for datasets with no valid timing, and the incomplete-data case now verifies preserved
weights, complete coverage and equal load.

Rejected: extending step/job/test limits, reducing sampling or repeats, raising worker counts beyond
the existing memory budget, and speculative filesystem/font/Chromium changes without causal evidence.
No output changes are intended and no goldens are re-recorded. Full local verification and the branch
Nightly's measured outcomes are recorded in the PR and final handoff.

The report follow-up repairs characters damaged by Windows' default text encoding using explicit
UTF-8. The scheduling code and recorded measurements are unchanged.
