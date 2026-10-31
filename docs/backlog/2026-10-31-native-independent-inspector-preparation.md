## Cause

Nightly 41217004219, Windows shard 4, still hits the agreement whole-test deadline after the redundant release operation is removed. Its held-scenario trace waits roughly 14 seconds for genuine fix verification, then spends roughly 6 seconds opening the inspector, and only then waits for genuine scenario sizing. The inspector can open independently of the verification reply. Serial preparation needlessly adds that UI work to the critical path.

## Repair and evidence

Start inspector opening and fix verification together, then await both before asserting the verified action and signalling that inspector preparation is complete. The held-plan regression therefore still proves that a verified fix does not establish a scenario-sizing reply. Preserve the same public diagram, traffic, eight samples, 15-second endpoint, ten-second trend and all original assertions. No timeout or input reduction.

A protocol regression holds the genuine verification reply, proves inspector preparation has started, and proves preparation has not completed until the reply arrives. Temporarily restoring serial preparation fails because inspector preparation has not started. All 11 verification units pass with the concurrent preparation restored. The complete owner spec passes 12 executions each on native Windows and Linux across two repetitions; loaded Linux passes all 30 across five repetitions at eight workers and four CPUs. Build, size, 41 units including 30 startup/reserve heavy cases, and all 3,178 unchanged parity goldens pass.
