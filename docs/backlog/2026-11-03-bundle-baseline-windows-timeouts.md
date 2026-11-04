## Native bundle-baseline fixture timeouts under overlapping checks

The #432 review-round unit run on Windows passed 14,944 tests but all three tests in
`src/lib/bundleBase.test.ts` exceeded Vitest's existing five-second timeout while other builds and
Linux browser checks were running. Their durations were 14.8, 10.5 and 15.8 seconds. The same
unchanged spec passed in the separate bundle gate and passed an isolated rerun (three tests in
3.37 seconds). No timeout, assertion or reserve was changed.

Investigate native process/install contention in this fixture without increasing its timeout or
changing the cache UX implementation. The full unit run was not repeated.
