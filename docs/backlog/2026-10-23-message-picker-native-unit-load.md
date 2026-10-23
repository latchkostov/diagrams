## Native unit backstops during hover-stacking verification

The native `pnpm test --maxWorkers=2` run under concurrent machine load hit the existing five-second backstop in scalingPlanner (two cases), checks/examples (three), retry-storm seeds 1/17/42, retries.noop (one), and waits.sampling (one). No simulation code or timeout was changed for the hover fix.

Only affected specs were tested in an untouched origin/master archive at `87e75d9337fbfe61b3c5446e11ee46c4232e6e3d` inside this checkout's ignored outputs. Two runs of scalingPlanner, checks/examples, retry-storm and retries.noop each reported 162 passed / 8 failed, reproducing their timeout patterns. Those archive runs also reported 26 source type-check errors because workspace dependency directories had not yet been linked; they are harness setup errors, not master regressions.

After linking the installed workspace dependencies, two narrowly filtered runs of retry-storm seed 17 and sampled CPU residence reported 26 passed / 1 failed and 25 passed / 2 failed, respectively, with no type errors. Together they reproduce both remaining test names and timeout errors. No full suite was run on master. Logs remain in `tests/.output/hover-master-{1,2}.log` and `tests/.output/hover-master-extra-{1,2}.log`.

Continue the existing native-unit-load investigation without weakening assertions, raising timeouts, or re-recording parity goldens. See the line-editing master-unit-timeout follow-up for the earlier independent reproductions.

## Completed native run

The run finished with 15,113 passed, 18 failed, 10 expected failures and 10 skipped, with no type errors. Ten failures were the backstops above. It crossed the second master merge and also mixed eight new dot-attachment tests with cached older modules (four each in flowBuilding and edgeEdits). Fresh processes on the final tree passed both specs and their type tests: 182 and 25 tests, respectively. The 515 targeted interaction, skill, viewer and startup-bundle tests also pass on the final tree. The initial full run is not a clean final-tree verification.
