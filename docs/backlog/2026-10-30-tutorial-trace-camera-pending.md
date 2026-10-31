## Intermittent trace tutorial camera readiness failure

PR #398 fix round 1 ran the syllabus smoke and existing tutorials spec twice in the Linux
Playwright image with four workers and four CPUs. Pass 1: 177 passed. Pass 2: 176 passed,
one failure in `trace-slowmo: its solution plays through the real UI`. Both syllabus smoke
runs passed. The failure was `waitForCameraIdle` in the authored hover action: `canvas-wrap`
remained `data-camera-state="pending"`, with both fit and chips pending. No assertion was
weakened, skipped or retried.

```text
SUMMARY: 3444e995b3ea53d2ac0dd720910f394391ee880b | unit="not run" parity="not run" e2e={"passed":353,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

The required focused comparison used a pristine archive of clean `origin/master`
`9b3e8b2b296cfacfbd1c67017d8d4a780c4d2970`, a fresh production E2E build in the same Linux
image, two workers/two CPUs, and `--repeat-each=2`. Both repetitions passed; this comparison
does **not** establish an identical failure on master. The camera, lesson and playback helper
are unchanged from that baseline. Per the verification-budget fix-round rule, record this
result and continue the focused push instead of repeating full suites or changing unrelated
camera behavior without evidence.

```text
SUMMARY: clean origin/master 9b3e8b2b296cfacfbd1c67017d8d4a780c4d2970 | {"startTime":"2026-10-31T01:21:59.438Z","duration":79981.151,"expected":2,"skipped":0,"unexpected":0,"flaky":0}
```

Local evidence: `tests/.output/g/rdjZWng/e2/` (report, error context and trace), and
`tests/.output/reset-master-repro/source/tests/.output/master-repro-results.json` (master).
Follow up if CI reproduces the pending camera, using its first-attempt trace and camera journal.
