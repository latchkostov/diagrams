# Portable gate measurements

Worker count reserves one quarter of available CPU capacity and 4 GiB RAM, then
allows 2.5 GiB per browser including trace buffers, capped at 12. A 10-core/24 GiB Mac gets 7 workers;
a 32-thread/64 GiB PC gets 12, and this PC's 31.2 GiB Docker VM gets 10.
`--workers` permits explicit experiments.

## Windows worker sweep

Ryzen 9 7950X (32 logical CPUs), 63.7 GiB RAM, SATA L: checkout, Node 24.22.0,
pnpm 12.11.2, Playwright 1.64.1. All 1,536 tests from all five CI projects run
in one invocation with zero retries. Times below exclude the four parallel builds.
The 8-worker checkpoint and the later sweep have the same browser tests.

| Workers | E2E seconds | Passed | Failed | Flaky |
| ------- | ----------- | ------ | ------ | ----- |
| 8       | 504.3       | 1,536  | 0      | 0     |
| 12      | 428.9       | 1,536  | 0      | 0     |
| 16      | 490.6       | 1,536  | 0      | 0     |
| 24      | 482.7       | 1,532  | 4      | 0     |

Twelve is the fastest green measurement: 15% faster than eight workers and 13%
faster than sixteen. Twenty-four exposed another late export notification, an
initial Lab fit not yet measured, redundant benchmark setup, and CPU starvation
in a held-font cancellation case. Their corrections are documented in the
[portability audit](GATE-PORTABILITY.md). Neither the worker rule nor the fixes
increase assertion timeouts or retries.

The complete 12-worker gate took 617.4 seconds: lint 18.4, types 1.6, format 16.0,
i18n 2.0, skill 0.9, units 60.0 (8,713 passed, four skipped), build 4.0, size 0.1,
parity 82.0 (all 2,196 unchanged), parallel E2E builds 2.9/2.9/2.0/2.0, and
E2E 428.9. Native and Linux acceptance runs retain their per-step timing tables,
project counts and total wall time in each run's `tests/.output/g/*/summary.json`.

## Linux resource and input controls

The first archive run at 12 workers took 743.9 seconds (546.4 E2E): 8,715 unit
tests passed, four were skipped, all 2,196 goldens matched, and E2E had 1,535
passed / two failed / zero flaky. A Lab trace write returned `ENOMEM`; a checks
responsiveness sample was 0.168529 CPU seconds against its 0.167952 same-run limit.

Browser profiles and reports now use Linux volumes in both transport modes, with
reports copied back after execution. The RAM reserve includes trace buffers, giving
this 31.2 GiB VM ten workers. Responsiveness compares identical text at every phase;
the 1.5x CPU limit, sample counts and 1,500-node workload are unchanged. Neither
failure was accepted or hidden with retries, timeout increases or golden updates.

## Linux source transport

Both full runs below test commit `3988f71c` in the pinned image, with ten workers,
warm dependency/store volumes, native report/profile volumes and zero retries.
Archive ran first, bind second. Each passed 8,721 unit tests (four skipped), all
2,196 unchanged goldens and all 1,537 browser tests, with zero failed or flaky.

| Step (seconds) | Archive | Bind  |
| -------------- | ------- | ----- |
| lint           | 21.0    | 24.8  |
| typecheck      | 1.6     | 3.7   |
| format         | 17.6    | 33.9  |
| i18n           | 1.8     | 2.4   |
| skill          | 1.1     | 2.7   |
| unit           | 59.7    | 82.3  |
| build          | 4.5     | 11.4  |
| size           | 0.1     | 0.1   |
| parity         | 63.1    | 84.6  |
| E2E build      | 3.5     | 10.2  |
| preview build  | 3.4     | 9.8   |
| internal build | 2.5     | 7.6   |
| locked build   | 2.3     | 7.6   |
| E2E            | 427.5   | 524.7 |
| total wall     | 626.2   | 794.4 |

The four E2E builds overlap; wall time also includes setup, transport and cleanup.
Archive saves 21% of total time and 19% of browser time on this SATA/NTFS checkout,
and exports exactly the commit being stamped. It is the full Linux gate's default.
Quick Linux runs bind the working edits. Per-run volume names prevent reuse after
a hard kill/PID recycle; report/profile mounts disable copy-up and reports return
to the host only after execution.

## Nightly dev target

The full native dev-server sweep at 12 workers passed 1,525 tests, skipped the
12 production-build-only cases and had zero failed or flaky, in 664.5 seconds.
Projects: chromium 1,451 passed / 12 skipped; dev 51; subpath 5; internal 12;
locked 6. This exercises the real Vite HMR handshake and the source-import tests,
in addition to the production-target gate. Vite emitted ResizeObserver diagnostics;
the sweep's assertions and error checks passed. Its servers were stopped before
the final unit/compiler checks.
