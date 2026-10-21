## Public-example simulation unit timeout under verification load

During the Confluence settings review fix, `pnpm test --maxWorkers=3` on Windows reported
13,332 passing tests, seven expected failures, four skipped tests and one failure:
`src/checks/examples.test.ts`, “simulation evidence on the public examples > blocking-call”.
It exceeded the existing 5,000 ms local test timeout (observed duration 5,489 ms), while production
builds, Forge browser repeats and parity were also running. There were no type errors.

The same spec was run once on a clean `origin/master` archive inside this checkout, with its
workspace dependencies linked and the same three-worker setting: **98 passed, zero failed**,
including the type-check tests. This does not establish that the timeout reproduces on master.
The settings fix changes no simulation or architecture-check code. Investigate the local timeout
under shared CPU load without weakening assertions or increasing its time budget.

Evidence: `tests/.output/forge-review-unit.log` and
`tests/.output/forge-review-master-spec.log`. Forge's independent three-repeat run passed
all 180 tests; the 2,779-golden parity check passed with no unexpected changes.
