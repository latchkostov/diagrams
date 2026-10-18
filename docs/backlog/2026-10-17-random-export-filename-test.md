## Random filename uniqueness test can fail on a legitimate collision

During Inspector extraction, `pnpm test --maxWorkers=4` failed at `src/export/lock.test.ts:136`: the
password-protected filename test got 199 distinct names from 200 calls, while expecting 200. The other
9,644 tests passed and four were skipped. An isolated rerun and a complete rerun (9,645 passed, four
skipped) passed; those reruns do not resolve the failure.

Both `src/export/lock.ts` and its test are unchanged from origin/master. `lockedFileName()` maps five
random bytes into a 31-character alphabet. Its finite suffix space permits collisions, so requiring
200 independent random draws to be distinct makes this test probabilistic.

Follow up separately: make the entropy-path test deterministic while retaining its assertions about
fresh entropy, suffix format and separation from diagram content. Review the production comment's
absolute uniqueness claim. Do not change Inspector behavior or weaken its tests to address this.
