## Dictation readiness remains unclassified

The final resilience feature full gate at `815009f9d4ceadabb810f9bde0979456a82dbeee`
passed all unit tests and parity, and 2,020 browser cases. The existing Chromium test
`ai-dictation.spec.ts:9`, "a restored AI dock offers dictation only after its canvas is ready",
failed because `ai-interim` did not show "Listening" after the microphone click. No dictation
code or assertion was changed for the retry feature.

## Feature gate

Command: `pnpm gate full --linux --workers 8 --cpus 12 --max-wait 1`.

```text
SUMMARY: 815009f9d4ceadabb810f9bde0979456a82dbeee | unit={"passed":14067,"failed":0,"skipped":8} parity={"goldens":3080,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":2020,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Report: `tests/.output/g/rJN8KEA`.

## Bounded clean-master comparison

Only `tests/e2e/ai-dictation.spec.ts` was run on clean `origin/master`, with two repetitions
and the same worker/CPU settings. The original Chromium case passed both times. A **different**
case, `@dev a temporary canvas host detach preserves the active dictation session`, timed out
once in `page.goto` before its dictation assertions. The result does **not** establish an
identical failure on master or prove that the original failure predates the feature.

```text
SUMMARY: 4877f5dce3595a83af56043f726fb1f929fedd87 | unit="not run" parity="not run" e2e={"passed":19,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Report: `tests/.output/resilience-master/tests/.output/g/r5I0BiO`.

## Follow-up

Preserve the held-canvas and microphone assertions. Use CI and the retained trace to determine
whether document readiness, speech-session lifetime or browser scheduling caused the original
failure. Continue delivery under the explicit bounded-verification instruction; do not claim
the full gate is green or repeat full suites to establish a baseline.
