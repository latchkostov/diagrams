## Investigate full Linux unit infrastructure timeouts

The batch-2 full gate on `2fdf1ef33cf5e8ae6330a718ab7ed271d0f869a5`, using eight workers/CPUs,
reported three failures in unchanged infrastructure specs:

- `src/lib/reviewLoop.test.ts`: detached-checkout suite setup exceeded the existing 10-second hook limit.
- `src/lib/bundleBase.test.ts`: changed-lock fixture cleanup exceeded the existing 10-second hook limit.
- `src/lib/packageManager.test.ts`: synchronized-dependency execution exceeded the existing 40-second test limit.

The full unit phase uses coverage. Two fresh targeted quick runs of just these three specs, without
coverage, on a clean `origin/master` checkout at `e927a2f54bbeb421955b1385125ce267fcaab7a7`
both passed all 48 tests using three workers/CPUs. This does **not** confirm pre-existing failures;
the full-run timeout conditions did not reproduce in isolation. Preserve all assertions and limits.
Investigate fixture subprocess and filesystem contention if CI reproduces them.

## Recorded results

The full attempt passed static checks, all heavy tests, production build, size and parity. It was
stopped under the verification-budget rule after 23.3 minutes, with 739 browser tests passed and
the remaining browser tests unrun. Its E2E FAIL is the deliberate interruption, not an assertion failure.
No passing full-gate stamp was produced. PR CI must complete the full browser matrix.

Exact full-attempt summary:

```text
SUMMARY: 2fdf1ef33cf5e8ae6330a718ab7ed271d0f869a5 | unit={"passed":14876,"failed":2,"skipped":28} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":739,"failed":0,"flaky":0,"skipped":2403} gate_failures=2
```

Both clean-master focused runs produced this summary:

```text
SUMMARY: e927a2f54bbeb421955b1385125ce267fcaab7a7 | unit={"passed":48,"failed":0,"skipped":0} parity="not run" e2e={"passed":0,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The required tutorial acceptance was independently green: 4,186 tutorial/import/save units, 206
reserve/skill heavy tests, 208 focused Linux browser checks across two repeats, and nine keyboard
tests selected by the complete file's shard 4/6 run. Earlier implementation failures were fixed;
the discovery paths now observe displayed results before closing their surfaces.
