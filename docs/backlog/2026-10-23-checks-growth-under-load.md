## Checks growth ratio under a shared Linux CPU quota

The #255 Linux quick gate (four workers sharing two CPUs) failed the unchanged
`src/checks/examples.test.ts` case “checks a 1,500-node diagram in linear time, every rule”.
The limit remains 24; no checks implementation or performance assertion was changed.

The same single case was checked twice on clean tracked `origin/master` (`78be9ef4`) sources,
archived inside this workspace, in the same Linux container and CPU quota. The second run reproduced
the assertion: `expected 26.579330398142385 to be less than 24`. Its runtime result was
`Tests 1 failed | 13 passed | 90 skipped (104)`. This archive initially lacked its workspace dependency
links, which also caused 26 unrelated type-resolution errors. Restoring links to the container's existing
workspace dependencies removed those setup errors; a recheck reported `Tests 14 passed | 90 skipped
(104)`, with no type errors. The checks assertion itself therefore fails intermittently under load,
including on unchanged master sources.

Investigate the deterministic work or the ratio harness under CPU throttling. Preserve the same-run
baseline, input growth factor and limit; do not raise the ratio threshold or hide the failure with retries.
Logs are retained under `tests/.output/review-master-linux-growth*.log`.
