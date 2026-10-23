## Additional results from the broad #255 Linux verification

The initial Linux quick gate used four workers sharing two CPUs and selected all nine UI neighbour
specs. Its unit stage completed with `passed: 14886, failed: 2, skipped: 10`. The checks growth failure
and its clean-master reproduction are recorded in `2026-10-23-checks-growth-under-load.md`.

The other failure was `src/interop/infra/tfScaling.test.ts`, “joins scaling resources in linear time”:
29.510932389334123 against the unchanged limit of 24. On clean tracked `origin/master` (`78be9ef4`)
sources in the same Linux container, two isolated-case checks passed. Two subsequent runs of only
that full spec also passed: `Tests 99 passed (99)` both times, with no type errors. This particular
ratio failure was not reproduced on clean master. No importer code, assertion, growth factor or
threshold was changed; investigate the ratio under concurrent CPU throttling.

Before the broad browser run was stopped to honor the verification budget, the unrelated annotations
case “inline auto-growth and inspector text stay within persistence limits on reload” hit its existing
30-second test timeout. Only this case was then run twice against production builds of the same clean
master sources on native Windows: both passed. That does not reproduce the Linux timeout or prove
the whole broad browser sweep passed. Preserve the assertions and investigate the work under load.

The remaining Linux repetitions were focused on the complete affected resilience spec and keyboard/focus
cases in annotations, drawing basics, round-four polish, viewport, platform and the inspector neighbours.
The broad run's unit failures and partial browser timeout remain reported rather than being treated
as a passing full gate. Logs are retained under `tests/.output/review-master-linux-tf*.log`,
`tests/.output/review-master-annotation.log` and `tests/.output/g/rP0Eft4-recovered/`.
