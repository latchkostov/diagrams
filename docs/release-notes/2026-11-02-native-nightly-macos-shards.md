## Native shard measurements

macOS Nightly now balances its twelve existing E2E shards using complete macOS measurements.
Linux and Windows retain the existing timing profile. No worker count, shard count, repetition,
test deadline, workflow limit, assertion, tolerance or budget changes.

The updater accepts native report bundles and excludes interrupted child reports. An explicit
missing profile fails instead of silently planning by counts. The profile is generated from
23 complete macOS reports from round 9's two dispatches. With the current inventory and the
same fallback for unmeasured files, the largest old assignment estimates 1,341.9 seconds of
native work; the new largest estimates 1,121.1 seconds (ratio 0.835). These are planning estimates,
not an observed runtime improvement.

Round 9's four unfinished macOS cases exhausted their shard's 25-minute step. Its 281 completed
tests consumed 1,430.072 seconds, leaving insufficient room for the final stress test and remaining
cases. They stay enabled. No output golden is re-recorded.
