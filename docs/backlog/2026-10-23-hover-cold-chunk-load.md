## Cold hover-frame downloads during Linux stress

After integrating master through `8c8a7f32`, the #255 snapshot at `6133a513` ran the five requested specs plus the gesture/focus neighbours with four workers and four Linux CPUs. Three repetitions completed:

- Repetition 1: 280 passed.
- Repetition 2: 276 passed, four failed, zero flaky.
- Repetition 3: 280 passed.

The failures were all in `hover-cards.spec.ts`: the Arabic and pseudo-locale pinned-card cases could not find the card, while the held-detail and Escape/hover cases hit the whole-test backstop. The originally reported CI cases and both 1280 × 800 no-scroll cases passed in all three completed repetitions. The extra repetitions were stopped to free the shared budget for the failed-spec master probe; the interrupted run did not emit an overall SUMMARY.

## Trace evidence and uncertainty

In the Arabic failure, the `NodeDetails` request began just before Enter and reported 16,868 ms total, including 16,854 ms waiting for its response. The card-focus assertion expired while this chunk was still in flight. Initial font and example requests also reported roughly 15-second waits. This establishes delayed loading in that trace; it does not establish the cause of those waits or exclude a PR-specific interaction issue. No keyboard behavior, assertion, axe rule or timeout was changed to hide the failure.

Only `tests/e2e/hover-cards.spec.ts` was then run once with `--repeat 2 --workers 4 --cpus 4` on clean master `8c8a7f32f69d3dd9ba4501b28ccc7864b989f778`, in an ignored scratch checkout inside this workspace. Both repeats passed. The failure is therefore **not established as pre-existing**; the probe was not repeated and no full master suite was run.

```text
SUMMARY: 8c8a7f32f69d3dd9ba4501b28ccc7864b989f778 | unit="not run" parity="not run" e2e={"passed":52,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The completed stress reports and traces are retained in `tests/.output/ci-final-snapshot/tests/.output/g/ruDQOiy/`, with copied failing traces in `tests/.output/ci-hover-failure-6133-r2/`. The master probe is in `tests/.output/ci-master-a11y-clean/tests/.output/g/ruyBLtK/`. Follow up on cold asset delivery and hover-frame readiness under equivalent load, preserving the pin/focus and geometry checks.
