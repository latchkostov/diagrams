## Existing Windows timeout in the cache-free replay gate

The isolated `w3-noop: blocking-call.json, saved simulation free-thread` case reaches Vitest's
existing 5,000 ms hang backstop on this Windows host. The same case reproduced twice in a clean
archive of `origin/master` at `6651153d9a73a61f6d1dc081f328772c6bc38e0b`, with dependencies shared
read-only from this checkout. No other master specs were run.

Both clean-master runs reported `Test Files 1 failed (1)` and
`Tests 1 failed | 178 skipped (179)`, with `Error: Test timed out in 5000ms.`
Durations were 8.45 s and 6.34 s. The feature run reported one timeout and 182 other no-op cases
passed; it additionally retains the frozen A1 Black Friday cohort. No assertion or backstop was
changed. Revisit the fixture's retained comparison work separately.

The isolated reproduction command was:

```sh
pnpm exec vitest run src/sim/caching.noop.heavy.test.ts -t "w3-noop: blocking-call.json, saved simulation free-thread" --maxWorkers=1
```

A resumed run of the full no-op cohort alongside production-bundle work reported the known
free-thread timeout plus `three-quick-retries` and `jittered-backoff` from the retry-storm example
(180 passed, three timed out). Those two retry cases passed together when rerun in isolation
with the unchanged 5 s backstop: two passed, 181 skipped, 8.35 s overall. No assertion changed.
