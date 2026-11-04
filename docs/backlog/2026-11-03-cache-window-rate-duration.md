## Cache recent-window rates use a nominal duration

The cache window retains nine complete one-second buckets plus the current partial bucket. After startup, `cacheRuntime.details()` divides its counts by ten seconds, although retained coverage varies from nine to ten seconds. Per-second hit, miss, and origin rates can therefore understate traffic near a second boundary. Hit ratio and origin-offload percentages divide counts from the same retained window, so this does not cause the Expected/Live percentage mismatch fixed by the cache agreement follow-up.

A separate change should return the actual retained duration and verify rates at fractional-second and whole-second boundaries with a fake simulation clock. Preserve the existing ring size and the agreement bounds. This would intentionally change cache snapshot goldens outside the follow-up's authorized Black Friday scope.
