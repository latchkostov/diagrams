## Nightly 41578118092: Linux investigation

Baseline: `3673242f2c8de7d14a7222291b74845913e28b50`. Reports and the local diagnostic driver remain in `tests/.output/nightly/` in this checkout. The driver exports tracked source into a Linux volume, uses the repo's shared gate worker admission and pinned `mcr.microsoft.com/playwright:v1.64.1-noble` image, and removes each container after copying its results and traces. It does not move the working branch. Historical commits are checked out in the detached `tests/.output/bisect` worktree.

## Reproduction commands and configuration

All named baseline/bisect cohorts use four Playwright workers, two container CPUs, 7 GiB memory, zero retries, Chromium, `CI=true`, `E2E_GATE=1`, and explicit ports 6540/6541/6542/6543/6544. The benchmark's existing browser CPU throttle remains 2. Each invocation uses `--repeat-each`, not retries.

The local driver commands are:

```powershell
node tests/.output/nightly-run.mjs base-dev-10 dev 10
node tests/.output/nightly-run2.mjs base-dev-20 dev 20
node tests/.output/nightly-run2.mjs base-build-10 build 10 'ask to drive, the host lets them'
node tests/.output/nightly-run2.mjs base-build-20 build 20 'ask to drive, the host lets them' tests/.output/bisect
```

The Dev commands select the unchanged RTL coach and off-pane benchmark tests together. Inside the archived Linux source they run:

```sh
E2E_TARGET=dev E2E_PORT=6540 E2E_DEV_PORT=6541 E2E_PREVIEW_PORT=6542 E2E_INTERNAL_PORT=6543 E2E_LOCKED_PORT=6544 E2E_GATE=1 E2E_CHROMIUM_ONLY=1 pnpm exec playwright test tests/e2e/tutorials-runtime.spec.ts tests/e2e/bench-harness.spec.ts --project=chromium --workers=4 --repeat-each=10 --retries=0 --forbid-only --grep 'RTL coach|benchmark fits'
```

The second Dev invocation uses twenty repetitions. Build uses the E2E production bundle (`VITE_E2E=1`), `E2E_TARGET=build`, the hosts-requests spec and its exact named-test filter. Playwright owns and stops its servers.

## Benchmark bisect

| Revision    | Position                                                     | Failures / repetitions |
| ----------- | ------------------------------------------------------------ | ---------------------: |
| `3673242f2` | Nightly baseline, with coach tests supplying additional load |                24 / 30 |
| `12c1bbd4e` | #421, middle of the suspect range                            |                 4 / 10 |
| `54bb1185e` | #420, first suspect merge                                    |                 4 / 10 |
| `d0ac286b3` | Before #420 and all seven suspect merges                     |                 4 / 10 |

Each bisect invocation selects only `benchmark fits`, with the same CPU, worker and throttle settings. Commands use `nightly-run2.mjs bisect-421`, `bisect-420` and `bisect-before-420`, respectively, with `dev 10 'benchmark fits' tests/.output/bisect` after checking out the named revision there. The original harness and test are unchanged throughout the seven-merge range. The sampling loop dates to `391857e79` (resizable side sheet); these observations do not assign a newly introduced product regression to any of the seven merges.

The scheduled trace's last viewport samples already agree. Its backstop expires after repeated pane/viewport reads across setup, off-pane validation, recovery Fit and selection. Loaded local traces also exhaust the whole-test deadline at different late helper calls; some cold executions spend much of it loading the first canvas. This does not prove a permanently moving camera or a stuck fit request.

Atomic pane/transform sampling alone is insufficient: the `final-dev-30` intermediate cohort still records **21/30 benchmark failures**. The final repair also removes duplicate setup/Fit waits, reuses the already-initialized DevTools session and uses the existing `performanceTest` fixture. It retains action traces and failure PNGs without snapshotting the entire 100-node DOM around each helper call. Camera readiness, two equal geometry samples, click/hit-test assertions, workloads, throttle and all timeouts stay unchanged.

## RTL coach: late Inspector layout predates the suspect range

The unchanged RTL case initially records **0/30** failures across `base-dev-10` and `base-dev-20`. The intermediate atomic-sampler cohort later records **1/30 coach failures**, with no application or coach-test change. The scheduled trace briefly targets the Simulation disclosure, then returns to `node-c` after lazy Inspector content puts Simulation below the visible dock. The final screenshot shows that off-screen disclosure state.

The causal diagnostic holds `src/planning/ui.ts`, lets the original test scroll to Simulation, then releases/evaluates planning and waits for `planning-explanation-c` before the unchanged coach-target assertion. This forces the observed late-layout ordering. All ten repetitions fail with the exact `inspector-section-node-simulation` versus `node-c` mismatch both at `d0ac286b3` (before every suspect merge) and `54bb1185e` (#420). The commands are `nightly-run2.mjs coach-before-420-held dev 10 'RTL coach' tests/.output/bisect` and `coach-420-held` after `prepare-held-coach.ps1 <revision>`.

The premature scroll dates to `dc3c68f4f3`, before the seven-merge range. This is a test-layout race rather than evidence against the new Selection actions control or coach measurement. The final test waits for the actual description editor and configured-planning section, then the disclosure's stable box, before scrolling. It retains the original field/disclosure and dock-placement assertions. Both new readiness units fail when that wait is temporarily removed; removing the camera readiness guard separately fails three sampler units.

## Driver handoff

The unchanged production-build case records **0/30** failures across `base-build-10` and `base-build-20`, reaching the requested stopping threshold. No culprit is assigned. A lack of local reproduction cannot distinguish a chunk-timing regression from the previously observed native flake, and does not justify a transport or engine change. The exact paused-tick comparison and digest assertion remain.

The watch coordinator, live-share protocol, live controller and watch bridge have no diff between `d0ac286b3` and `3673242f2`. That does not rule out timing changes from other chunks. Earlier native admission/knock failures also do not establish that the scheduled 315-versus-455 paused-tick mismatch is the same failure.

## Output and intermediate verification

An early attempt added a viewport test id. Browser parity detected that attribute in exported SVG metadata, so the marker and its generated-viewer change were removed. No golden was re-recorded. The completed parity rerun passes **3,178 goldens, zero changed/added/missing/stale**, alongside 41 units. The final production source and skill output are unchanged; additional tutorial-readiness units pass separately.

The reserve heavy file passes all 32 tests. Production build and size checks pass, including locale, viewer and Forge resource budgets.

## Final repetition results

| Cohort                | Configuration                                                                                     | Result                                   |
| --------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `repaired-dev-30`     | Four workers / two CPUs / 7 GiB; named coach and benchmark cases, thirty repetitions each         | 60 passed, 0 failed, 0 flaky, 0 skipped  |
| `full-dev-specs-30`   | Six workers / four CPUs / 7 GiB; both complete Dev spec files, thirty repetitions each            | 390 passed, 0 failed, 0 flaky, 0 skipped |
| `full-hosts-build-30` | Six workers / six CPUs / 7 GiB; complete production-build hosts-requests file, thirty repetitions | 120 passed, 0 failed, 0 flaky, 0 skipped |

The named coach and benchmark improve to **0/30 failures each** in the original four-worker/two-CPU stress configuration. The final host sweep adds another thirty clean executions of the exact drive-handoff case, without a collaboration change. These are local observations, not proof that every future Nightly is green.

The full-spec commands use `nightly-run2.mjs full-dev-specs-30 dev 30 '.*' tests/.output/bisect` with `NIGHTLY_WORKERS=6 NIGHTLY_CPUS=4`, and `full-hosts-build-30 build 30 '.*' tests/.output/bisect` with six workers/six CPUs. They retain the same pinned image, zero retries and explicit five-port range. The diagnostic runner uses Docker init for child-process reaping in these final cohorts.

## Neighbour admission: busy fallback

The requested 27-file neighbour sweep is enumerated in `tests/.output/nightly/neighbour-specs.json`: `tutorials-*`, `bench-harness`, `hosts-*`, `keyboard-*` and `lowzoom*`. The attempt requests two repetitions, twelve workers/eight CPUs/24 GiB, ports 6580–6584 and `--max-wait 1`, plus the three targeted unit files, through `pnpm gate quick --linux --only unit,e2e`.

Another checkout acquired six of the twelve shared slots before admission. The attempt reports **busy exit 75** after one minute (the pnpm lifecycle wrapper exits 1). No unit or browser test starts in that attempt, so it has no SUMMARY line. Per the explicit busy-capacity fallback, the branch is pushed for PR CI rather than waiting or altering a live reservation. No local neighbour result is claimed. The final three-file native unit invocation passes 43 tests.

## Completed parity SUMMARY

```text
SUMMARY: 3673242f2c8de7d14a7222291b74845913e28b50 | unit={"passed":41,"failed":0,"skipped":0} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":0,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

This is a quick working-tree gate, not a full verification stamp. New readiness units also pass natively, including both completion orders. Lint, typecheck, `pnpm format:check` and the explicit `pnpm exec prettier --check .` are the final pre-commit checks. `pnpm sync` completed successfully; origin/master remains the tested Nightly commit. No full gate is queued in this fix round, and no retry, skip, quarantine, timeout, tolerance or bundle budget is changed.
