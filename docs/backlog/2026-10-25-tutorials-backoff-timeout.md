## Existing backoff-budget completion regression timeout

The build-11 tutorial run passes 2,106 tests and skips 147 quarantined cases, but
`completionSweep.test.ts` → `backoff-budget: jitter fails the backlog expectation but the same seeded budget run
recovers` exceeds Vitest's existing 5-second test timeout.

The same isolated test times out twice on clean source archived from `origin/master`
(`489125be16616b3294fbb9ceaa4d5096c4e95370`) inside this worktree's ignored test-output directory. Both probes use
Node 24.22.0, the same frozen dependencies and one Vitest worker. Each reports **1 failed, 1,527 skipped**;
durations are 11.47 s and 6.75 s including transform/import work. The test itself hits the same 5-second timeout
in both probes. No timeout or assertion was relaxed.

Investigate the test's seeded backoff workload and its synchronous simulation work in the resilience lane.
The three new design studies' completion and evidence cases pass independently.
