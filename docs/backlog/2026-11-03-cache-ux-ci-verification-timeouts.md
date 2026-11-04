## Heavy simulation checks exceed their existing timeout

The #432 CI-regression follow-up ran the full native unit suite with four workers: 16,372 passed, five timed out, 14 expected failures and 13 skipped (789 files). No assertions or timeouts were changed.

Four timeouts in `src/sim/caching.noop.heavy.test.ts` reproduced in an isolated native rerun and in both focused Linux runs of a clean `origin/master` snapshot at `641c94ec572e24ac99d417bd9281da4e29372a81`:

- Black Friday, `doors-open`.
- Blocking call, `free-thread`.
- Retry storm, `three-quick-retries`.
- Retry storm, `jittered-backoff`.

The clean snapshot used an archive in a temporary Linux volume, without changing the working branch. Only the affected unit files and tutorial export spec ran. The first unit repetition had five timeouts (also Retry storm's `shed-load`); the second had the four above. All failed on the existing five-second backstop. Investigate the cost of these comparisons without dropping ticks, fields or cases, or raising the timeout.

The fifth native full-suite failure was `src/checks/examples.heavy.test.ts`, simulation evidence for Retry storm. It passed twice in isolation on the branch and twice on clean master. This remains a load-sensitive observation, not an established deterministic regression.

## Tutorial HTML export timeout under the broad browser run

The 780-case Linux run passed 778 cases. One failure was the intermediate Black Friday summary, subsequently shortened further. The other was `tutorials-apply-present.spec.ts`, “batch6 assisted and dialog HTML exports retain Private provenance”: the existing 30-second test backstop interrupted `download.path()` for the dialog export. The same spec passed all 46 cases across two focused runs on clean master, then all 46 across two focused branch runs. No identical clean-master browser failure was established. Investigate this intermittent download completion timeout without relaxing the test.

The final branch runs of lazy surfaces, i18n, the affected keyboard tutorial group and cache UX passed all 372 cases across two repetitions, including the shorter summary. Both focused branch gates reported zero failures and zero flakes.

The baseline runner's browser summary was:

```text
SUMMARY: 641c94ec572e24ac99d417bd9281da4e29372a81 | unit="not run" parity="not run" e2e={"passed":46,"failed":0,"flaky":0,"skipped":0} gate_failures=1
```

The summary counts the browser lane only; the failure status also includes the separate focused unit commands described above. Local evidence is in `tests/.output/cache-ux-ci-units.log`, `tests/.output/cache-ux-ci-unit-timeout-rerun.log`, `tests/.output/cache-ux-ci-baseline.log` and `tests/.output/g/r6UNoqs/`.
