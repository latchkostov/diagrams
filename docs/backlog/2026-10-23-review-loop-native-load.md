## Native browser failures during PR 268's fix round

The full native gate on the signed implementation commit `cd0d21f38b4bacf1e6b16dada3512964555d037d`
passed static checks, unit coverage, build, size, all 3,146 unchanged parity goldens and Docker smoke
checks. Its browser run reported 35 failures across these specs:

- `capacity.spec.ts`: 5; `csp.spec.ts`: 1; `image-slices.spec.ts`: 10.
- `interop.spec.ts`: 1; `library-regressions.spec.ts`: 8; `perf.spec.ts`: 3.
- `self-host.spec.ts`: 5; `share-chooser.spec.ts`: 1; `text-fields.spec.ts`: 1.

```text
SUMMARY: cd0d21f38b4bacf1e6b16dada3512964555d037d | unit={"passed":15381,"failed":0,"skipped":10} parity={"goldens":3146,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2146,"failed":35,"flaky":0,"skipped":4} gate_failures=1
```

A clean detached master fixture at `2c6a463cb0f79dfd44c025c06aad486120ddacc9`, inside the current
workspace's ignored review directory, installed frozen dependencies and ran only those nine spec
files on the same native host, with twelve workers and two repetitions:

```sh
pnpm gate quick tests/e2e/capacity.spec.ts tests/e2e/csp.spec.ts tests/e2e/image-slices.spec.ts tests/e2e/interop.spec.ts tests/e2e/library-regressions.spec.ts tests/e2e/perf.spec.ts tests/e2e/share-chooser.spec.ts tests/e2e/text-fields.spec.ts tests/e2e/self-host.spec.ts --only e2e --repeat 2 --workers 12 --max-wait 1
```

Both repetitions passed all 171 cases. None of the 35 full-load failures reproduced in this bounded
comparison, so they are not individually confirmed baseline failures. Application sources and
browser specs are identical between the implementation and master; the only changed source test
is `src/lib/reviewLoop.test.ts`. Its 62 tests pass, and the four new regressions fail when the
preparation and README fixes are temporarily reverted.

```text
SUMMARY: 2c6a463cb0f79dfd44c025c06aad486120ddacc9 | unit="not run" parity="not run" e2e={"passed":342,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Verification limitation: the fixture's dependency installation overlapped the late part of the
full browser run and may have added disk load. The full gate is not a passing verification stamp.
No second full suite or clean-master full suite was run, and no product assertion or golden was
changed. This documentation-only follow-up records the uncertainty for PR CI under the bounded
verification policy.

Owner: Live Diagrams maintainers. Investigate native full-load scheduling and the unconfirmed
browser failures while preserving assertions and output goldens.
