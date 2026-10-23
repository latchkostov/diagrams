## Stencil gallery accessibility scan under load

The deliberate reversion of the #255 assertion updates reproduced its three original failures, plus an unrelated 30-second whole-test timeout in the light-theme stencil gallery scan. That run used six workers sharing four Linux CPUs. The unchanged final assertions had already passed the complete three-worker Linux gate (2,078 browser cases); no axe rule, assertion or timeout was relaxed.

## Clean-master evidence

Only `tests/e2e/a11y.spec.ts` was run once with `--repeat 2 --workers 6 --cpus 4` on clean `origin/master` (`6637eecf42cf9751f8b9834a47f01571d120ee81`) sources in an ignored scratch checkout inside this workspace. Both repetitions reproduced the same light-theme stencil scan timeout. All other accessibility cases passed, including the problem hover cards. This is a test hang backstop under load, not an axe rule violation.

```text
SUMMARY: 6637eecf42cf9751f8b9834a47f01571d120ee81 | unit="not run" parity="not run" e2e={"passed":78,"failed":2,"flaky":0,"skipped":0} gate_failures=2
```

Reports are retained locally in `tests/.output/ci-master-a11y-clean/tests/.output/g/rTiBNzg/`; the negative control is in `tests/.output/g/r9Hvux2/`. Investigate the gallery scan's work under a shared CPU quota without increasing the timeout or excluding accessibility rules.
