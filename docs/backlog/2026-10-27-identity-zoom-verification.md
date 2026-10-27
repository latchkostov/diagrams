## Host embed particle assertion on the unchanged base

The targeted Windows production Chromium run for identity zoom completed with 336 passes and six failures across two repetitions. Two failures were the same host embed case: `host-embed.spec.ts`, “the host page supplies the diagram: it renders, plays, takes commands and reports back”, line 283. Playback reports playing, but `data-particles` remains zero.

The unmodified production E2E benchmark bundle built from clean `63fba7a708937297ef662e723e8600885fd15b87`, before this branch's edits, reproduces that exact assertion in both repetitions: **2 failed, 4 passed** when selecting the host case, encrypted HTML export and the phone EV showcase. Application source and browser specs are identical between that base and `origin/master` at `2895e9c8e`; the intervening change concerns Nightly reporting and its tests/docs. Reports are local under `tests/.output/zoom-work/master-check.{log,json}`.

The other four initial failures were the encrypted HTML success-toast assertion and Live readiness in three phone showcase cases (payments ledger, delivery dispatch, EV charging). The encrypted export and all three showcase cases pass both isolated base repetitions; the additional payments/delivery check reports **4 passed**. Retain the initial traces and investigate readiness/load if CI reproduces them; no assertion or timeout was relaxed for this performance change.

The final head bundle reran all five cases plus held zoom in all three node variants, twice: **14 passed, 2 failed**. Only the identical host particle assertion remains. Reports are local under `tests/.output/zoom-work/head-check.{log,json}`.

The requested Linux load run was restarted after the final gesture visibility correction. Its six-worker/four-CPU request exited 75 because another live gate held eight of the twelve shared slots. Do not remove its lease or treat the five repeats as passed; PR CI remains necessary.
