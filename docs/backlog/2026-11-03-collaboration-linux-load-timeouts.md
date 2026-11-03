## Unconfirmed collaboration timeouts in the full Linux gate

The cache-agreement branch's single full Linux gate at `659f0bf1034c36e7f2deb3ebad08dc2267d52e04` passed unit coverage, heavy tests, production build, size, parity and static checks, but reported two 30-second timeouts in `tests/e2e/collab-c1a.spec.ts`:

- `pasting Private content stops sharing before the paste reaches peers or room recovery`
- `corrupt IndexedDB checkpoint recovers safely and quota failure preserves downloadable edits`

The full run used 12 workers and 12 CPUs. Its exact summary was:

```text
SUMMARY: 659f0bf1034c36e7f2deb3ebad08dc2267d52e04 | unit={"passed":16037,"failed":0,"skipped":13} parity={"goldens":3302,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":3381,"failed":2,"flaky":0,"skipped":11} gate_failures=1
```

Only the affected spec was replayed on a clean `origin/master` checkout (`cdb0515c4baf5ab34b1f2fbc387bb267f9291877`), in the same worktree, with production builds and two repetitions. The initial 12-worker admission exited 75 without running tests. An eight-worker/eight-CPU reservation fit the shared budget and passed both repetitions:

```text
SUMMARY: cdb0515c4baf5ab34b1f2fbc387bb267f9291877 | unit="not run" parity="not run" e2e={"passed":44,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Neither failure reproduced in this replay; pre-existing failure status is unproven. The task branch was restored unchanged. No assertion, timeout or budget was changed, and no second full suite was run, following the verification-budget instruction to record the targeted replay and push.

Follow up on the failed traces and any corresponding PR CI results to determine whether the failures depend on broader suite contention. Keep the existing assertions and backstops. Local evidence is in `tests/.output/g/rveeLb8/e1/` (full gate), `tests/.output/g/ryU4R5a/e1/` and `e2/` (clean-master replay).
