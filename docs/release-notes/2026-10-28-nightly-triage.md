## Nightly triage: locale download regressions

The development-server locale tests now intercept the actual split catalog URLs, including
`de-core` and optional surface buckets. A shared matcher keeps development and production
interception aligned; unit regressions cover language/bucket boundaries and query strings.
The old development matcher reproduces the Nightly failure before the fix.

This repairs the test harness without changing application behaviour. No parity golden changes
are intended or re-recorded. The [triage table](../backlog/2026-10-28-nightly-triage.md) records
every failed job, the prior-run comparison and unresolved native/property workload failures.
