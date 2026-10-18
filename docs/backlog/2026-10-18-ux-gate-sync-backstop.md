## Investigate the Windows sync-test backstop under concurrent verification

The PR #178 CI-fix follow-up ran `pnpm test --maxWorkers=4`: 11,349 passed, one failed and four
skipped, with no type errors. The only failure was `src/lib/sync.test.ts`,
`sync preserves both sides of authored conflicts`, exceeding the existing five-second local backstop
(9.2 s) while a Linux gate and another verification were running. No sync implementation or test
changed in this follow-up.

Only the matching spec was checked on a clean source archive of origin/master
`a386fea790abfc5c876d0a8754c31cbf15d2ecb6`, inside this checkout's ignored test output. Both isolated
runs passed (28 tests each), as did the branch's isolated run (28 tests). This does not establish a
reproduced master failure. The archive reused installed dependencies; Vitest was invoked directly
because pnpm's workspace-location check rejects the dependency junction in an archive.

Investigate Git subprocess overhead and contention if this recurs. Do not weaken conflict assertions
or raise the timeout to hide it. No full suite was run on master. Local logs:
`tests/.output/ux-gate-ci-unit.log`, `tests/.output/ux-gate-master-sync-{1,2}.log`, and
`tests/.output/ux-gate-branch-sync.log`.
