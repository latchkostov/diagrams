## Coverage job failure was an artifact service timeout

In [run 40203120081, attempt 1, Unit coverage 1/3](https://github.com/latchkostov/diagrams/actions/runs/40203120081/job/121198311586),
the Unit coverage step succeeded: 196 files passed, one skipped; 4,436 tests passed, four expected
failures and 13 skipped. Istanbul printed its coverage summary. The next upload-artifact step
failed with `Failed to CreateArtifact: Unable to make request: ETIMEDOUT`. This blocked merged
coverage and made the aggregate checks fail. It was not an unhandled rejection, worker crash or
coverage threshold. There are no coverage thresholds configured in `vitest.config.ts`.

Do not suppress stderr, accept a missing coverage artifact or add a test retry to address this
external service failure. Investigate the artifact service/network if it recurs. The later attempt
passed. Test-only editor stubs have separately been completed, with assertions that unexpected
console errors fail their tests while still reaching the real logger.

[Run 40209134287](https://github.com/latchkostov/diagrams/actions/runs/40209134287/attempts/1)
does not share the no-failed-test signature: its three coverage shards reported 37, two and one
failed tests respectively (example validation, known-flake identity/geometry, and simulation
example assertions). Its coverage uploads succeeded. These historical feature-branch failures
are separate from the caught action predicate TypeErrors and are not attributed to a crash.
