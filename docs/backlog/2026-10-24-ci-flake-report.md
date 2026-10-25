## CI flake evidence (60-run snapshot)

Repository: latchkostov/diagrams. Workflow: CI. Runs: 60, all branches, newest first. Snapshot ends at 2026-10-25T02:56:58Z (run 40156378975).

Counts are distinct failing test/job attempts, deduplicating repeated Actions log annotations. Test IDs use project, spec and full title; source line numbers are deliberately excluded. Earlier attempts of rerun workflows are included, as are failures logged before a job was cancelled. A later successful shard on the identical SHA is passing-rerun evidence; it is not evidence that the cause was fixed. No later passing shard means **unconfirmed**, not a persistent failure. Cancelled/in-progress jobs are excluded from wall-time samples. Infrastructure failures without a test ID are listed separately.

| Test ID                                                                                                                                                       | Failures | Distinct branches                                | Passed same SHA (failures confirmed) | Shards  | Evidence (run/attempt)                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ------------------------------------------------ | -----------------------------------: | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [chromium] tests/e2e/collab-room.spec.ts › a joiner retrying from the chip keeps the keyboard on its wait; the alert stays below the bar, on the diagram only |        2 | fix/p2-a11y-focus                                |                                  0/2 | E2E 6/6 | [40142999205/1](https://github.com/latchkostov/diagrams/actions/runs/40142999205/job/121018670746), [40143706958/1](https://github.com/latchkostov/diagrams/actions/runs/40143706958/job/121020885793) |
| [chromium] tests/e2e/collab-room.spec.ts › a room dialog gives focus back to what opened it; Retry hands it to the room's status                              |        2 | fix/p2-a11y-focus                                |                                  0/2 | E2E 6/6 | [40142999205/1](https://github.com/latchkostov/diagrams/actions/runs/40142999205/job/121018670746), [40143706958/1](https://github.com/latchkostov/diagrams/actions/runs/40143706958/job/121020885793) |
| [chromium] tests/e2e/editor.spec.ts › editor › shortcuts modal contains Tab and Shift+Tab, closes with Escape and restores focus                              |        2 | feat/tutorials-build-01                          |                                  0/2 | E2E 6/6 | [40140947883/1](https://github.com/latchkostov/diagrams/actions/runs/40140947883/job/121012581202), [40141846466/1](https://github.com/latchkostov/diagrams/actions/runs/40141846466/job/121015360641) |
| [chromium] tests/e2e/lazy-recording.spec.ts › recording waits before countdown and captures the released narration                                            |        2 | feat/tutorials-build-02, feat/tutorials-build-03 |                                  0/2 | E2E 5/6 | [40152133528/1](https://github.com/latchkostov/diagrams/actions/runs/40152133528/job/121045835998), [40155063812/1](https://github.com/latchkostov/diagrams/actions/runs/40155063812/job/121054828557) |
| [chromium] tests/e2e/editor.spec.ts › editor › group a selection into a boundary and rename it                                                                |        1 | fix/p2-a11y-focus                                |                                  0/1 | E2E 6/6 | [40142999205/1](https://github.com/latchkostov/diagrams/actions/runs/40142999205/job/121018670746)                                                                                                     |
| [chromium] tests/e2e/health-current.spec.ts › recovered breaker is healthy with past timeouts in Outcomes, light                                              |        1 | feat/tutorials-build-02                          |                                  0/1 | E2E 2/6 | [40155063812/1](https://github.com/latchkostov/diagrams/actions/runs/40155063812/job/121054828587)                                                                                                     |
| [chromium] tests/e2e/i18n.spec.ts › canvas chrome in ar › context menus, submenus and command palette translate and wrap                                      |        1 | fix/p2-a11y-focus                                |                                  0/1 | E2E 3/6 | [40142999205/1](https://github.com/latchkostov/diagrams/actions/runs/40142999205/job/121018670731)                                                                                                     |
| [chromium] tests/e2e/i18n.spec.ts › canvas chrome in de › context menus, submenus and command palette translate and wrap                                      |        1 | fix/p2-a11y-focus                                |                                  0/1 | E2E 3/6 | [40142999205/1](https://github.com/latchkostov/diagrams/actions/runs/40142999205/job/121018670731)                                                                                                     |
| [chromium] tests/e2e/i18n.spec.ts › canvas chrome in en-XA › context menus, submenus and command palette translate and wrap                                   |        1 | fix/p2-a11y-focus                                |                                  0/1 | E2E 3/6 | [40142999205/1](https://github.com/latchkostov/diagrams/actions/runs/40142999205/job/121018670731)                                                                                                     |
| [chromium] tests/e2e/inspector-layout.spec.ts › axe Inspector edge-call in light                                                                              |        1 | feat/tutorials-build-02                          |                                  0/1 | E2E 3/6 | [40152796727/1](https://github.com/latchkostov/diagrams/actions/runs/40152796727/job/121047984660)                                                                                                     |
| [chromium] tests/e2e/inspector-layout.spec.ts › reselecting breaker On preserves tuned settings and Undo history                                              |        1 | fix/p2-hover-live-3                              |                                  0/1 | E2E 3/6 | [40155344077/1](https://github.com/latchkostov/diagrams/actions/runs/40155344077/job/121055780064)                                                                                                     |
| [chromium] tests/e2e/inspector-layout.spec.ts › retry segments persist selections and preserve custom policies                                                |        1 | fix/p2-hover-live-3                              |                                  0/1 | E2E 3/6 | [40155344077/1](https://github.com/latchkostov/diagrams/actions/runs/40155344077/job/121055780064)                                                                                                     |
| [chromium] tests/e2e/inspector-live.spec.ts › held connection lazyEdgePanel chunk preserves rename keys and Escape                                            |        1 | fix/p2-message-types-1                           |                                  0/1 | E2E 4/6 | [40155160074/1](https://github.com/latchkostov/diagrams/actions/runs/40155160074/job/121055332096)                                                                                                     |
| [chromium] tests/e2e/password-links.spec.ts › password links › moving to another diagram during an unlock drops its result                                    |        1 | feat/tutorials-build-01                          |                                  0/1 | E2E 2/6 | [40141846466/1](https://github.com/latchkostov/diagrams/actions/runs/40141846466/job/121015360567)                                                                                                     |
| [chromium] tests/e2e/present.spec.ts › presenting full screen › going full screen and back refits a diagram shown whole to the pane                           |        1 | fix/p2-a11y-focus                                |                                  1/1 | E2E 4/6 | [40145432799/1](https://github.com/latchkostov/diagrams/actions/runs/40145432799/job/121025848624)                                                                                                     |
| [chromium] tests/e2e/request-deadlines.spec.ts › Timeout validates whole milliseconds, bounds and clearing, and is undoable                                   |        1 | fix/p2-tooling-followups                         |                                  1/1 | E2E 5/6 | [40152332912/1](https://github.com/latchkostov/diagrams/actions/runs/40152332912/job/121046494338)                                                                                                     |
| [chromium] tests/e2e/requests-wait-checks.spec.ts › worker fallback keeps the displayed timeout actionable                                                    |        1 | feat/tutorials-build-01                          |                                  0/1 | E2E 5/6 | [40141846466/1](https://github.com/latchkostov/diagrams/actions/runs/40141846466/job/121015360589)                                                                                                     |
| [chromium] tests/e2e/ux-resilience-followup.spec.ts › reselecting enabled resilience controls preserves tuning and the Undo step                              |        1 | fix/p2-hover-live-3                              |                                  0/1 | E2E 5/6 | [40152744216/1](https://github.com/latchkostov/diagrams/actions/runs/40152744216/job/121047733936)                                                                                                     |

## Shard wall time

Completed shard jobs include setup, downloads and uploads, excluding queue time. Budget: 22 minutes (current workflow job timeout, not the test timeout). Historical runs can use older infrastructure. Means combine completed attempts; compare a complete recent run before refreshing the duration map.

| Shard   | Samples | Mean seconds | Max seconds | Mean / budget | Mean / shard mean |
| ------- | ------: | -----------: | ----------: | ------------: | ----------------: |
| E2E 1/6 |      39 |        825.9 |       984.0 |         62.6% |            123.4% |
| E2E 2/6 |      40 |        555.9 |       862.0 |         42.1% |             83.1% |
| E2E 3/6 |      42 |        794.9 |      1036.0 |         60.2% |            118.8% |
| E2E 4/6 |      45 |        489.5 |       816.0 |         37.1% |             73.1% |
| E2E 5/6 |      37 |        807.4 |      1094.0 |         61.2% |            120.6% |
| E2E 6/6 |      42 |        542.5 |       708.0 |         41.1% |             81.1% |

Over 125% of the shard mean: none.

## Latest complete successful shard set

Run 40154781593, SHA cc0c05b3442923b3f769f32d6c65ccc1d2a0684b. This same-run comparison avoids averaging different infrastructure revisions.

| Shard   | Seconds | Budget used | Relative to mean |
| ------- | ------: | ----------: | ---------------: |
| E2E 1/6 |     956 |       72.4% |           139.1% |
| E2E 2/6 |     533 |       40.4% |            77.5% |
| E2E 3/6 |     883 |       66.9% |           128.5% |
| E2E 4/6 |     398 |       30.2% |            57.9% |
| E2E 5/6 |     821 |       62.2% |           119.4% |
| E2E 6/6 |     533 |       40.4% |            77.5% |

Over 125% of this run's mean: E2E 1/6, E2E 3/6.

## Collection coverage

Run conclusions: cancelled: 15, failure: 8, in_progress: 5, success: 32.

## Runs in the snapshot

| Run                                                                             | SHA                                      | Branch                           | Conclusion at collection | Attempts |
| ------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------- | ------------------------ | -------: |
| [40156378975](https://github.com/latchkostov/diagrams/actions/runs/40156378975) | fb688645255ab36f44f336d09fc3d3d3a4cf743e | fix/inspector-findings-list-a11y | in_progress              |        1 |
| [40156185473](https://github.com/latchkostov/diagrams/actions/runs/40156185473) | 08beb113d5289fa04cbe9c2fe53072b0a5536598 | fix/p2-tooling-followups-2       | in_progress              |        1 |
| [40155775005](https://github.com/latchkostov/diagrams/actions/runs/40155775005) | 348a30139ca872aec5c08e97121626aed9cef4c1 | fix/p2-message-types-1           | in_progress              |        1 |
| [40155344077](https://github.com/latchkostov/diagrams/actions/runs/40155344077) | 5e38ebc8b5632f1d05d56726f3966179e526d3f1 | fix/p2-hover-live-3              | in_progress              |        1 |
| [40155160074](https://github.com/latchkostov/diagrams/actions/runs/40155160074) | 8a32f648b74b9c40a5b09eadb647360a4db6db0c | fix/p2-message-types-1           | cancelled                |        1 |
| [40155063812](https://github.com/latchkostov/diagrams/actions/runs/40155063812) | 5d9bd750069fdcf6d6a621607fe57d66f5a1f07e | feat/tutorials-build-02          | in_progress              |        2 |
| [40154781593](https://github.com/latchkostov/diagrams/actions/runs/40154781593) | cc0c05b3442923b3f769f32d6c65ccc1d2a0684b | feat/tutorials-build-04          | success                  |        1 |
| [40154680705](https://github.com/latchkostov/diagrams/actions/runs/40154680705) | 8fc18c574daee59044e5d4247d2f251fe0774a51 | feat/tutorials-build-05          | success                  |        1 |
| [40154413379](https://github.com/latchkostov/diagrams/actions/runs/40154413379) | 606cc3e7b40e179277dd3619be7def302a952c7e | master                           | success                  |        1 |
| [40154038426](https://github.com/latchkostov/diagrams/actions/runs/40154038426) | c30c408ab4f2abbf3785b337b3f4b2c5af043937 | fix/engine-recovery-leaks        | success                  |        1 |
| [40153665137](https://github.com/latchkostov/diagrams/actions/runs/40153665137) | 836c2d8d8336b9775d98fb2ba86dcd872faf2b79 | fix/engine-recovery-leaks        | cancelled                |        1 |
| [40153195644](https://github.com/latchkostov/diagrams/actions/runs/40153195644) | 9ab95aded1fd85fa79f7d90463b0d298cc6dec6e | fix/p2-message-types-1           | success                  |        1 |
| [40152796727](https://github.com/latchkostov/diagrams/actions/runs/40152796727) | bcc57b1382d61e7e857bd256f927316620e5812c | feat/tutorials-build-02          | failure                  |        1 |
| [40152744216](https://github.com/latchkostov/diagrams/actions/runs/40152744216) | 93b628856bfb28e23435f58e50a3cff9901efabb | fix/p2-hover-live-3              | failure                  |        1 |
| [40152513007](https://github.com/latchkostov/diagrams/actions/runs/40152513007) | 30a2c22da0055039c7d2b5074e57bb4f2db01692 | master                           | success                  |        1 |
| [40152332912](https://github.com/latchkostov/diagrams/actions/runs/40152332912) | 04a9dab7d1ad6ce7f22581967f6e5384b503b281 | fix/p2-tooling-followups         | success                  |        2 |
| [40152177440](https://github.com/latchkostov/diagrams/actions/runs/40152177440) | cb568d987f1a0e6565255eda5741df725ba3a5f5 | fix/p2-message-types-1           | cancelled                |        1 |
| [40152133528](https://github.com/latchkostov/diagrams/actions/runs/40152133528) | 725e43b39f06a607d3ae8534fe38a3be1ebb1f1b | feat/tutorials-build-03          | failure                  |        1 |
| [40151490788](https://github.com/latchkostov/diagrams/actions/runs/40151490788) | 82e418f2e7ebb2c267c64a6cea17d9b99c8749b6 | feat/tutorials-build-02          | success                  |        1 |
| [40151456384](https://github.com/latchkostov/diagrams/actions/runs/40151456384) | c1cd084751b29b098373229dd0ddac0b5e07226e | feat/resilience-checks           | success                  |        1 |
| [40151365631](https://github.com/latchkostov/diagrams/actions/runs/40151365631) | 14fb79b3da02fcf6d0a29baa2bba6767f06f3535 | fix/p2-hover-live-3              | success                  |        1 |
| [40150982769](https://github.com/latchkostov/diagrams/actions/runs/40150982769) | bb5f0605b6e2d9650f91eeb272e27507a01d6241 | master                           | success                  |        1 |
| [40150605349](https://github.com/latchkostov/diagrams/actions/runs/40150605349) | 05a430c8cd4edb251ae3ebc742d1cff8bed98696 | master                           | cancelled                |        1 |
| [40150314748](https://github.com/latchkostov/diagrams/actions/runs/40150314748) | 498b253c49049a360aabd8bd95ce3fe8f43e7c41 | master                           | cancelled                |        1 |
| [40150119979](https://github.com/latchkostov/diagrams/actions/runs/40150119979) | de94cd667db6f43a2e6fedcd3683e13e575c93b7 | feat/tutorials-build-02          | success                  |        1 |
| [40150104709](https://github.com/latchkostov/diagrams/actions/runs/40150104709) | 79a693950894e725bf5ba2a606bcafa486d78ddd | feat/tutorials-build-02          | cancelled                |        1 |
| [40150013880](https://github.com/latchkostov/diagrams/actions/runs/40150013880) | 9a955d58f6a600686c379e820eecf40d00334d75 | fix/p2-lazy-loading-tests        | success                  |        1 |
| [40149489009](https://github.com/latchkostov/diagrams/actions/runs/40149489009) | ec36dcfb6266c8193a8b067a41350e94ff6c568d | fix/p2-line-editing              | success                  |        1 |
| [40149220174](https://github.com/latchkostov/diagrams/actions/runs/40149220174) | 9ffd474b62abc01c3f82cffdb3099cecd2024e42 | master                           | success                  |        1 |
| [40149099640](https://github.com/latchkostov/diagrams/actions/runs/40149099640) | a7f2c29bf46b33ee3d430e1ed8138bcaca9719c6 | fix/p2-performance-tooling       | success                  |        1 |
| [40148858777](https://github.com/latchkostov/diagrams/actions/runs/40148858777) | 71c630086c5fd682f89bac62cea98e07ff4160ed | feat/tutorials-build-02          | success                  |        1 |
| [40148243169](https://github.com/latchkostov/diagrams/actions/runs/40148243169) | 6ae90cb55739bc14118b850fecbeaec16ed1fa7c | feat/tutorials-build-02          | cancelled                |        1 |
| [40148231221](https://github.com/latchkostov/diagrams/actions/runs/40148231221) | f2155c8a8636e271f9518e97a6a9007a8ec14939 | fix/p2-line-editing              | success                  |        1 |
| [40148124948](https://github.com/latchkostov/diagrams/actions/runs/40148124948) | 135066fdeb4071845492c6a800d0a894a21d4472 | fix/p2-hover-live                | success                  |        1 |
| [40147114640](https://github.com/latchkostov/diagrams/actions/runs/40147114640) | dd315166d9573b1911ea8415d7d55e4f6d590d5c | master                           | success                  |        1 |
| [40146803802](https://github.com/latchkostov/diagrams/actions/runs/40146803802) | 2e34e6b94e8353c65a0b349003d2a1aa4cbadc77 | feat/resilience-checks           | success                  |        1 |
| [40146539182](https://github.com/latchkostov/diagrams/actions/runs/40146539182) | 3647780c6e422f4bd76d580ce90b62ef7e91dd09 | fix/p2-hover-live                | failure                  |        1 |
| [40145432799](https://github.com/latchkostov/diagrams/actions/runs/40145432799) | c978d8d0639f9782f7b350afe5af5eb182bf632a | fix/p2-a11y-focus                | success                  |        2 |
| [40145246086](https://github.com/latchkostov/diagrams/actions/runs/40145246086) | f88b544314bbaa7b40b2b2b8409461c7292835be | master                           | success                  |        1 |
| [40144893540](https://github.com/latchkostov/diagrams/actions/runs/40144893540) | 91060f02aaa2473111aeecc994df9158d11e7dd4 | fix/p2-hover-live                | failure                  |        1 |
| [40144861464](https://github.com/latchkostov/diagrams/actions/runs/40144861464) | 929c64eaa97fb28276e923e330d09e79ea41587c | feat/resilience-checks           | success                  |        1 |
| [40144524964](https://github.com/latchkostov/diagrams/actions/runs/40144524964) | 66b5fbe8bb831d2513f91c9b2849550e03d48835 | feat/resilience-checks           | cancelled                |        1 |
| [40144383704](https://github.com/latchkostov/diagrams/actions/runs/40144383704) | c1d6fd88c634d58e86c2b63ab734daf06961835d | feat/resilience-checks           | cancelled                |        1 |
| [40144371140](https://github.com/latchkostov/diagrams/actions/runs/40144371140) | 5ad0d8b992edd57f394eb4805337adbf1a0d47f8 | fix/p2-hover-live                | cancelled                |        1 |
| [40144206669](https://github.com/latchkostov/diagrams/actions/runs/40144206669) | 1cd52ab4ad128d4fb910c317ed5186109358e994 | feat/resilience-checks           | cancelled                |        1 |
| [40144059567](https://github.com/latchkostov/diagrams/actions/runs/40144059567) | ff6275be7f9f9d2ef3c7a54aa9b1ca4df66379cf | feat/tutorials-build-01          | success                  |        1 |
| [40143706958](https://github.com/latchkostov/diagrams/actions/runs/40143706958) | 91aa47043bb3c75126f61806f726b443ef759bfa | fix/p2-a11y-focus                | failure                  |        1 |
| [40142999205](https://github.com/latchkostov/diagrams/actions/runs/40142999205) | b42a7c2ed8f1f8d0e7e789bb9aa9c866fdad8178 | fix/p2-a11y-focus                | cancelled                |        1 |
| [40142382735](https://github.com/latchkostov/diagrams/actions/runs/40142382735) | 8e58be7e421cd6b812d85ec0182a13244d59e8de | master                           | success                  |        1 |
| [40141846466](https://github.com/latchkostov/diagrams/actions/runs/40141846466) | 565f00012f6da3d0f96512922746d5a587c39dc4 | feat/tutorials-build-01          | failure                  |        1 |
| [40141325780](https://github.com/latchkostov/diagrams/actions/runs/40141325780) | 41bda95d66cc3c7a2c2d4317dde51654038f12ad | feat/load-shedding               | success                  |        1 |
| [40140947883](https://github.com/latchkostov/diagrams/actions/runs/40140947883) | 4f63e7e052b2b09082068bd880ad0bbd17c2d808 | feat/tutorials-build-01          | cancelled                |        1 |
| [40140608951](https://github.com/latchkostov/diagrams/actions/runs/40140608951) | 91223610d6e2062775c67e8bb70f2f044f70b1c7 | master                           | success                  |        1 |
| [40140020896](https://github.com/latchkostov/diagrams/actions/runs/40140020896) | 672949a9d482a6d434145eb6f24422264b54912d | master                           | success                  |        1 |
| [40139462674](https://github.com/latchkostov/diagrams/actions/runs/40139462674) | 05f5386f1997dc124a96ee6282849e0a058c7ad6 | perf/trim-3                      | success                  |        1 |
| [40138856032](https://github.com/latchkostov/diagrams/actions/runs/40138856032) | 6279358c21e0f9440bd1e75c585a3dde3b589445 | fix/p2-tests-ci-2                | success                  |        1 |
| [40138691033](https://github.com/latchkostov/diagrams/actions/runs/40138691033) | 02bc704adcd4d0bbac19baaa1eb33696cb23b33c | perf/trim-3                      | cancelled                |        1 |
| [40138660253](https://github.com/latchkostov/diagrams/actions/runs/40138660253) | ce249849d47f2e74cc23210f2edfca5b10b56369 | feat/load-shedding               | failure                  |        1 |
| [40138353195](https://github.com/latchkostov/diagrams/actions/runs/40138353195) | cf04709a4491a54bbe635991685157e7c0ba1dd9 | fix/p2-tests-ci-2                | cancelled                |        1 |
| [40138147107](https://github.com/latchkostov/diagrams/actions/runs/40138147107) | fcb2e15b0ef44cfd249037a3df2225d159c42b21 | master                           | success                  |        1 |
