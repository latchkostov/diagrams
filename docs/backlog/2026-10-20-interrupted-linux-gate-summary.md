## Preserve the summary when a Linux gate is interrupted

The Forge pilot's full Linux gate was intentionally stopped after two unit failures, so their fixes
could be checked with targeted tests within the verification budget. The host copied the reports,
then exited with `ENOENT` while opening the absent `summary.json`, without printing a `SUMMARY:` line.
The copied E2E checkpoint retained 322 passed, zero failed/flaky and `interrupted: true` out of 1,884
expected tests. Unit results and completed build/parity logs were also retained.

Follow up in the Linux gate transport: synthesize an interrupted summary from the available step
reports and checkpoint when the container cannot write its final summary, then print the usual
summary and interruption status. Cover this missing-summary path in the gate transport tests.
