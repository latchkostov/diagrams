## Whole-test timeouts under shared Linux load

The cache-aside branch's initial five-repeat UI run used six workers on three CPUs
while another gate occupied six shared slots. It finished with 1,067 passed,
43 failed and zero flaky cases. All ten cache-aside cases passed. The failures were
in `annotations.spec.ts`, `inspector-layout.spec.ts` and `inspector-live.spec.ts`.

## Clean-master evidence

A clean snapshot of `origin/master` at
`9cb33865770b2b89aebf9c5fc7b5146900e0bca3` ran only those three spec files, twice,
with the same six-worker/three-CPU settings. Its tracked files were clean before
the run. Reports are in the local ignored baseline snapshot's
`tests/.output/g/rqWmOR1/` directory.

```text
SUMMARY: 9cb33865770b2b89aebf9c5fc7b5146900e0bca3 | unit="not run" parity="not run" e2e={"passed":232,"failed":10,"flaky":0,"skipped":0} gate_failures=2
```

Both annotation tests timed out in both repeats:

- `annotations.spec.ts:944`: inline auto-growth and Inspector persistence limits.
- `annotations.spec.ts:1011`: adding annotations and shapes from the canvas menu.

The second repeat also timed out in all six variants of
`inspector-layout.spec.ts:172`: segmented labels at 1280/1440 px in English,
pseudo-localized English and Arabic. The first repeat passed those variants close
to their existing whole-test limit. The Live accessibility cases passed in both
baseline repeats and are not included in this pre-existing-failure claim.

## Follow-up

Reduce repeated setup or separate independent journeys in the long tests while
preserving their assertions and coverage. Keep real background-check readiness,
viewport/focus checks, persistence limits and locale checks. Do not increase time
limits or replace readiness with fixed sleeps. Recheck with declared shared-budget
workers and CPUs; the cache-aside PR also records balanced six-worker/six-CPU runs.
