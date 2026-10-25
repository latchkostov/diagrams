## CI flake evidence (60-run snapshot)

Repository: latchkostov/diagrams. Workflow: CI. Runs: 60, all branches, newest first. Snapshot ends at 2026-10-25T10:04:02Z (run 40183230379).

Counts are distinct failing test/job attempts, deduplicating repeated Actions log annotations. Test IDs use project, spec and full title; source line numbers are deliberately excluded. Earlier attempts of rerun workflows are included, as are failures logged before a job was cancelled. Interrupted/cancelled tests do not count as failures. A later successful shard on the identical SHA is passing-rerun evidence; it is not evidence that the cause was fixed. No later passing shard means **unconfirmed**, not a persistent failure. Cancelled/in-progress jobs are excluded from wall-time samples. Infrastructure failures without a test ID are listed separately.

| Test ID                                                                                                                              | Failures | Distinct branches                                                                                                                     | Passed same SHA (failures confirmed) | Shards           | Evidence (run/attempt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------: | ------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------------: | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [chromium] tests/e2e/inspector-layout.spec.ts › segments keep one Tab stop and change the saved policy with arrow, Home and End keys |        8 | chore/bundle-trim-p05, feat/tutorials-build-03, fix/engine-recovery-leaks, fix/p2-message-types-2, fix/p2-tooling-followups-3, master |                                  0/8 | E2E 3/6          | [40161308059/1](https://github.com/latchkostov/diagrams/actions/runs/40161308059/job/121073500045), [40162149151/1](https://github.com/latchkostov/diagrams/actions/runs/40162149151/job/121075978433), [40163001457/1](https://github.com/latchkostov/diagrams/actions/runs/40163001457/job/121079348909), [40163876974/1](https://github.com/latchkostov/diagrams/actions/runs/40163876974/job/121081049674), [40163876974/2](https://github.com/latchkostov/diagrams/actions/runs/40163876974/job/121083957350), [40164983441/1](https://github.com/latchkostov/diagrams/actions/runs/40164983441/job/121084233510), [40165451874/1](https://github.com/latchkostov/diagrams/actions/runs/40165451874/job/121085633943), [40166576362/1](https://github.com/latchkostov/diagrams/actions/runs/40166576362/job/121088910101) |
| [chromium] tests/e2e/inspector-live.spec.ts › held connection lazyEdgePanel chunk preserves rename keys and Escape                   |        2 | feat/tutorials-runner-checks, fix/p2-line-editing-2                                                                                   |                                  1/2 | E2E 4/6, E2E 6/6 | [40160789032/1](https://github.com/latchkostov/diagrams/actions/runs/40160789032/job/121071925132), [40174957924/1](https://github.com/latchkostov/diagrams/actions/runs/40174957924/job/121113693337)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [chromium] tests/e2e/hover-cards.spec.ts › deleting a pinned node closes its readout and Undo restores an unpinned target            |        1 | fix/p2-performance-pointer-1                                                                                                          |                                  0/1 | E2E 5/6          | [40176788030/1](https://github.com/latchkostov/diagrams/actions/runs/40176788030/job/121120464849)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [chromium] tests/e2e/lazy-recording.spec.ts › Live and recording start while discovery remains held                                  |        1 | feat/tutorials-runner-checks                                                                                                          |                                  1/1 | E2E 2/6          | [40177174942/1](https://github.com/latchkostov/diagrams/actions/runs/40177174942/job/121121119989)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Shard wall time

Completed shard jobs include setup, downloads and uploads, excluding queue time. Budget: 22 minutes (current workflow job timeout, not the test timeout). Historical runs can use older infrastructure. Means combine completed attempts; compare a complete recent run before refreshing the duration map.

| Shard   | Samples | Mean seconds | Max seconds | Mean / budget | Mean / shard mean |
| ------- | ------: | -----------: | ----------: | ------------: | ----------------: |
| E2E 1/6 |      43 |        777.0 |       972.0 |         58.9% |            112.7% |
| E2E 2/6 |      44 |        630.3 |       768.0 |         47.7% |             91.4% |
| E2E 3/6 |      43 |        683.5 |       872.0 |         51.8% |             99.2% |
| E2E 4/6 |      44 |        640.7 |       820.0 |         48.5% |             92.9% |
| E2E 5/6 |      43 |        702.2 |      1109.0 |         53.2% |            101.9% |
| E2E 6/6 |      44 |        702.0 |       865.0 |         53.2% |            101.8% |

Over 125% of the shard mean: none.

## Latest complete successful shard set

Run 40182043384, attempt 1, SHA 7c9d55ba2268bccf00997ca10724107c0a4a67b4. This same-attempt comparison avoids averaging different infrastructure revisions or mixing partial reruns.

| Shard   | Seconds | Budget used | Relative to mean |
| ------- | ------: | ----------: | ---------------: |
| E2E 1/6 |     616 |       46.7% |            94.6% |
| E2E 2/6 |     595 |       45.1% |            91.4% |
| E2E 3/6 |     574 |       43.5% |            88.1% |
| E2E 4/6 |     736 |       55.8% |           113.0% |
| E2E 5/6 |     560 |       42.4% |            86.0% |
| E2E 6/6 |     827 |       62.7% |           127.0% |

Over 125% of this run's mean: E2E 6/6.

## Collection coverage

Run conclusions: cancelled: 14, failure: 9, in_progress: 1, success: 36.

## Runs in the snapshot

| Run                                                                             | SHA                                      | Branch                            | Conclusion at collection | Attempts |
| ------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------- | ------------------------ | -------: |
| [40183230379](https://github.com/latchkostov/diagrams/actions/runs/40183230379) | 84e514ef22072841511426c69a1941a6730823f4 | chore/skill-zip-trim-1            | in_progress              |        1 |
| [40182623955](https://github.com/latchkostov/diagrams/actions/runs/40182623955) | 972aab1f8dff3cfabeb18fc52b7dc0eae43369e3 | master                            | success                  |        1 |
| [40182043384](https://github.com/latchkostov/diagrams/actions/runs/40182043384) | 7c9d55ba2268bccf00997ca10724107c0a4a67b4 | chore/skill-zip-trim-1            | success                  |        1 |
| [40181546124](https://github.com/latchkostov/diagrams/actions/runs/40181546124) | 17be52971cfaea1cdaad143961bbca6b8295d22f | feat/tutorials-build-04           | success                  |        1 |
| [40180391897](https://github.com/latchkostov/diagrams/actions/runs/40180391897) | 4889358eefef0af188076a2a1ce3cc4fd4ce5252 | feat/tutorials-build-05           | success                  |        1 |
| [40179322662](https://github.com/latchkostov/diagrams/actions/runs/40179322662) | 666411cc42c6c0777f27b6efa075a0793085c146 | master                            | success                  |        1 |
| [40179036665](https://github.com/latchkostov/diagrams/actions/runs/40179036665) | bdfd2a7f6ed889ba5d9fef3dfb608dafc18de64d | master                            | cancelled                |        1 |
| [40178403044](https://github.com/latchkostov/diagrams/actions/runs/40178403044) | c616a9860a115e8693288b5b6c01ad6f6c8a59ad | fix/p2-performance-pointer-1      | failure                  |        1 |
| [40177820240](https://github.com/latchkostov/diagrams/actions/runs/40177820240) | 966a63a5c5dc4c162ef32e893d5370b7b169003d | fix/p2-performance-pointer-1      | cancelled                |        1 |
| [40177353250](https://github.com/latchkostov/diagrams/actions/runs/40177353250) | 4b094de395805e17494a63e530402c98c26c780d | fix/nightly-triage-2026-10-25     | success                  |        1 |
| [40177174942](https://github.com/latchkostov/diagrams/actions/runs/40177174942) | 5fff15818b8f714162fe10d53515502e102a65b4 | feat/tutorials-runner-checks      | success                  |        2 |
| [40176788030](https://github.com/latchkostov/diagrams/actions/runs/40176788030) | a6b2b0b1ddc8482ebc14362b3f4a2fcaff48439c | fix/p2-performance-pointer-1      | cancelled                |        1 |
| [40176765906](https://github.com/latchkostov/diagrams/actions/runs/40176765906) | 0c1dacb1ee529bc24b5deef5b596f1986922b7aa | fix/nightly-triage-2026-10-25     | cancelled                |        1 |
| [40174957924](https://github.com/latchkostov/diagrams/actions/runs/40174957924) | 53f5aacfdc0f6e6d6ff771441d66982ca3b118f9 | feat/tutorials-runner-checks      | failure                  |        1 |
| [40174606044](https://github.com/latchkostov/diagrams/actions/runs/40174606044) | 28a8e686582b4d9228ed5b0f2b2639065214a4c9 | feat/sampling-8b-deadline-cohorts | failure                  |        1 |
| [40173220349](https://github.com/latchkostov/diagrams/actions/runs/40173220349) | 5a7986fbbd7ca4a1883a6932a2ec44ebbc018517 | master                            | success                  |        1 |
| [40172946202](https://github.com/latchkostov/diagrams/actions/runs/40172946202) | cde965eb9903e7812a71ec85809f62ef6455a2ab | master                            | cancelled                |        1 |
| [40172552677](https://github.com/latchkostov/diagrams/actions/runs/40172552677) | 8bc43a28da7997eb78b40232403a4a075e3bee98 | master                            | cancelled                |        1 |
| [40172226633](https://github.com/latchkostov/diagrams/actions/runs/40172226633) | 2a7f65e0bba14c75816993348a52a606c6bc6704 | fix/p2-message-examples-followups | success                  |        1 |
| [40172093959](https://github.com/latchkostov/diagrams/actions/runs/40172093959) | 9f5e1a4a17c37e8da41eedddc2e3f442998943d9 | feat/sampling-8b-deadline-cohorts | failure                  |        1 |
| [40172029004](https://github.com/latchkostov/diagrams/actions/runs/40172029004) | bec995928cae6281a7664f398e79b5723674757c | fix/p2-flake-report-2             | success                  |        1 |
| [40171625395](https://github.com/latchkostov/diagrams/actions/runs/40171625395) | af1bbd191f0152b669a2defe86d64c8658dbace0 | feat/tutorials-build-03           | success                  |        1 |
| [40170585868](https://github.com/latchkostov/diagrams/actions/runs/40170585868) | cdbb17338f32387315796bbb115193d65999a116 | master                            | success                  |        1 |
| [40170574828](https://github.com/latchkostov/diagrams/actions/runs/40170574828) | 4e9230dfc018c7a2e99619043a78ed08a8e45a48 | feat/tutorials-build-03           | success                  |        1 |
| [40170484235](https://github.com/latchkostov/diagrams/actions/runs/40170484235) | 021d77e056c8c9c7649f3700c628a4a41f34ff26 | master                            | cancelled                |        1 |
| [40169631826](https://github.com/latchkostov/diagrams/actions/runs/40169631826) | 16bc16cd7abacc0821bbe0b9da2a7967deb8e603 | fix/p2-message-types-2            | success                  |        1 |
| [40169626566](https://github.com/latchkostov/diagrams/actions/runs/40169626566) | be1c4232f5d8a13c2e1d3c743cba7ed7daaaa518 | fix/review-loop-test-fixture      | success                  |        1 |
| [40169004275](https://github.com/latchkostov/diagrams/actions/runs/40169004275) | c40ad0ab9da5864f246608ae58128b154ae5dda6 | fix/p2-message-types-2            | cancelled                |        1 |
| [40168377819](https://github.com/latchkostov/diagrams/actions/runs/40168377819) | 2c80c7314f706b3fa6c89f84e704bd19f22c4b5c | feat/tutorials-build-03           | success                  |        1 |
| [40168063862](https://github.com/latchkostov/diagrams/actions/runs/40168063862) | 4a58a7fc5424066969089d51849cb6ae54c4d52a | master                            | success                  |        2 |
| [40168001623](https://github.com/latchkostov/diagrams/actions/runs/40168001623) | 39d46534bd862d10ac8a8806f046b4fbe4478a14 | master                            | cancelled                |        1 |
| [40167176299](https://github.com/latchkostov/diagrams/actions/runs/40167176299) | e6789a1ac6506601d99fb4456b5a06c7bf5bf399 | fix/p2-message-types-2            | failure                  |        1 |
| [40167171404](https://github.com/latchkostov/diagrams/actions/runs/40167171404) | c50824924bd6e96f76e1a5c216e73c4876b0e2d3 | fix/engine-recovery-leaks         | success                  |        1 |
| [40167165660](https://github.com/latchkostov/diagrams/actions/runs/40167165660) | 9fe1c9a138db4a4ac6543d6caf72aaeac9cf3327 | fix/p2-tooling-followups-3        | success                  |        1 |
| [40167059668](https://github.com/latchkostov/diagrams/actions/runs/40167059668) | 87d70690ce32e1d9252e4a784234925d55f990b8 | master                            | success                  |        1 |
| [40166576362](https://github.com/latchkostov/diagrams/actions/runs/40166576362) | 39255f9bfb17dea000f595d1f2c0e92aeb44f7f9 | fix/p2-message-types-2            | cancelled                |        1 |
| [40166176243](https://github.com/latchkostov/diagrams/actions/runs/40166176243) | 9a2bb423fbf0e742adac9b100a4ec613cf7942f5 | fix/flake-segments-tab-stop       | success                  |        1 |
| [40165451874](https://github.com/latchkostov/diagrams/actions/runs/40165451874) | 7d5b08fbd7bc479b4d97ed9042f71d3ab1db718b | fix/engine-recovery-leaks         | failure                  |        1 |
| [40165372792](https://github.com/latchkostov/diagrams/actions/runs/40165372792) | 3f5f54747a2eeb7c0f70a052a0e30d0673211938 | fix/p2-message-types-2            | failure                  |        1 |
| [40164983441](https://github.com/latchkostov/diagrams/actions/runs/40164983441) | d6ecc6216fe4dedfad47852e0eee56fb3415f5f2 | fix/p2-tooling-followups-3        | failure                  |        1 |
| [40164777639](https://github.com/latchkostov/diagrams/actions/runs/40164777639) | b2db07b4d5d1c666e792678a9110201920c2b849 | master                            | success                  |        1 |
| [40164437165](https://github.com/latchkostov/diagrams/actions/runs/40164437165) | 541b9a6fe9ef0fb0d3fb3eb358bf3d6f08080a98 | fix/engine-recovery-leaks         | success                  |        1 |
| [40163876974](https://github.com/latchkostov/diagrams/actions/runs/40163876974) | 266c72d3a39afd992f6a610023009b7d8fde1e06 | feat/tutorials-build-03           | failure                  |        2 |
| [40163813913](https://github.com/latchkostov/diagrams/actions/runs/40163813913) | b14feba66c166f5f0f5071b9dfb61f051d01184d | chore/bundle-trim-p05             | success                  |        1 |
| [40163001457](https://github.com/latchkostov/diagrams/actions/runs/40163001457) | 0c9317558786de0e72a9524c444fcb521882d946 | chore/bundle-trim-p05             | cancelled                |        1 |
| [40162636120](https://github.com/latchkostov/diagrams/actions/runs/40162636120) | f56a1395023a65bf3eb8e8f01703dc153890be26 | master                            | success                  |        1 |
| [40162318572](https://github.com/latchkostov/diagrams/actions/runs/40162318572) | a433905145e13bb7cb1bc5857460c6fe355482ac | feat/tutorials-build-03           | success                  |        1 |
| [40162149151](https://github.com/latchkostov/diagrams/actions/runs/40162149151) | 3234a45b07e1caeb2c7670e6da4857ef6725a809 | master                            | cancelled                |        1 |
| [40162014180](https://github.com/latchkostov/diagrams/actions/runs/40162014180) | b5c0f8d1c30d429f5cf377b229ac25687ca6966a | feat/tutorials-build-03           | cancelled                |        1 |
| [40161582216](https://github.com/latchkostov/diagrams/actions/runs/40161582216) | bfa7ea77995acee8baab6025fc58171c649b8a7d | master                            | success                  |        1 |
| [40161308059](https://github.com/latchkostov/diagrams/actions/runs/40161308059) | b1c6da5cfbd69417e54c8f0a9b6264c870c0bfd7 | feat/tutorials-build-03           | cancelled                |        1 |
| [40161126766](https://github.com/latchkostov/diagrams/actions/runs/40161126766) | ba57ef56795c074a8a167b960877efe343919cd7 | fix/collab-diagnostics-cache      | success                  |        1 |
| [40160789032](https://github.com/latchkostov/diagrams/actions/runs/40160789032) | 4e1327efbb926cfba2f41156ddd292c7228e3d7e | fix/p2-line-editing-2             | success                  |        2 |
| [40160715597](https://github.com/latchkostov/diagrams/actions/runs/40160715597) | 722dd5d75d8ab64f729661c5f177e99bc022ec3f | fix/ci-flake-tail                 | success                  |        1 |
| [40160537533](https://github.com/latchkostov/diagrams/actions/runs/40160537533) | 62e064a13b31010b15e3ef9a50cdf98968403cff | master                            | success                  |        1 |
| [40159465244](https://github.com/latchkostov/diagrams/actions/runs/40159465244) | 1336310b9887b54b8808a54526590eaa4b4e3e15 | fix/p2-hover-live-3               | success                  |        1 |
| [40159459417](https://github.com/latchkostov/diagrams/actions/runs/40159459417) | 5cb11830ecd2c6e5ecdad29fe8dc451e68a18f88 | fix/p2-line-editing-2             | success                  |        1 |
| [40159325686](https://github.com/latchkostov/diagrams/actions/runs/40159325686) | 3bc9c3349b83660f27bee653bd98787feaf92562 | feat/tutorials-build-03           | success                  |        1 |
| [40159120647](https://github.com/latchkostov/diagrams/actions/runs/40159120647) | 58032de3c68d78e650f092231449e1764f097254 | master                            | success                  |        1 |
| [40158276035](https://github.com/latchkostov/diagrams/actions/runs/40158276035) | 2c4d6bbeaa4c6c34a17550e5f7573602791bfe3b | fix/p2-line-editing-2             | success                  |        1 |
