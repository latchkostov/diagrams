## Host embed particle assertion on the unchanged base

The targeted Windows production Chromium run for identity zoom completed with 336 passes and six failures across two repetitions. Two failures were the same host embed case: `host-embed.spec.ts`, “the host page supplies the diagram: it renders, plays, takes commands and reports back”, line 283. Playback reports playing, but `data-particles` remains zero.

The unmodified production E2E benchmark bundle built from clean `63fba7a708937297ef662e723e8600885fd15b87`, before this branch's edits, reproduces that exact assertion in both repetitions: **2 failed, 4 passed** when selecting the host case, encrypted HTML export and the phone EV showcase. Application source and browser specs are identical between that base and `origin/master` at `2895e9c8e`; the intervening change concerns Nightly reporting and its tests/docs. Reports are local under `tests/.output/zoom-work/master-check.{log,json}`.

The other four initial failures were the encrypted HTML success-toast assertion and Live readiness in three phone showcase cases (payments ledger, delivery dispatch, EV charging). The encrypted export and all three showcase cases pass both isolated base repetitions; the additional payments/delivery check reports **4 passed**. Retain the initial traces and investigate readiness/load if CI reproduces them; no assertion or timeout was relaxed for this performance change.

The final head bundle reran all five cases plus held zoom in all three node variants, twice: **14 passed, 2 failed**. Only the identical host particle assertion remains. Reports are local under `tests/.output/zoom-work/head-check.{log,json}`.

The requested Linux load run was restarted after the final gesture visibility correction. Its six-worker/four-CPU request exited 75 because another live gate held eight of the twelve shared slots. Do not remove its lease or treat the five repeats as passed; PR CI remains necessary.

## Linux gate and focused follow-up

The full Linux gate was interrupted after two browser failures; its completed work must not be reported as a green full gate:

```text
SUMMARY: 0bf7b74f4dab87edfab5251fbfdd1b3a85e55879 | unit={"passed":14144,"failed":0,"skipped":13} parity={"goldens":3178,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1670,"failed":2,"flaky":0,"skipped":1205} gate_failures=1
```

The failures were the Overview bench-harness case reaching its whole-test timeout after fourteen zoom-button clicks, and `imports.spec.ts:820` measuring a fitted card at 107.85px against its existing greater-than-110px assertion. Clean `origin/master` (`2895e9c8e721286d8be8dc94c5ac8afe544631a3`), checked out in an ignored local proof clone, ran only those two cases twice: **4 passed, 0 failed, 0 flaky**. These failures were therefore not reproduced in that isolated base check.

The follow-up extends held identity scaling to manual zoom-button/key animations while retaining exact automatic-fit scaling. Regression units failed before that correction and pass afterward. The Linux focused run of camera, fit-settled, imports, bench-harness and Windows/Mac held-zoom coverage, twice with six workers/four CPUs, reports **103 passed, 1 failed, 0 flaky**. Only the same Overview whole-test timeout recurred, during selection readiness after the zoom clicks; imports and every identity case passed. Keep this unresolved timeout visible for CI rather than increasing timeouts or weakening assertions. Local reports: `tests/.output/zoom-work/{full-gate,master-focused,fix-focused}.log`.
