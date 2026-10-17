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
