## Windows progress readers can fail an otherwise passing gate

The S1 relay full gate completed every application test, but its checkpoint reporter raised
`EPERM` when atomically renaming `checkpoint.json.tmp` over `checkpoint.json`. A live progress
read briefly held the destination open without delete sharing on Windows. Do not read the
live checkpoint with such a handle; the append-only step log remains available for progress.

Exact full-gate result on the signed implementation commit:

```text
SUMMARY: 7b42d0ffe20d9c238063fbb1120e657286e61498 | unit={"passed":11023,"failed":0,"skipped":4} parity={"goldens":2424,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1649,"failed":0,"flaky":0,"skipped":4} gate_failures=1
```

There was one reporter error outside any test, no failed or flaky browser tests, and no
verification stamp. All static checks, builds, size and parity passed.

The reporter is unchanged by S1: both branch and master have blob
`0f9857278f97dc5c78dfe4401d348e0cb3208b7b`. A clean `git archive origin/master`
at `0e83bfabe7284b3e95e99e2f3fc0c463d2c12f12` reproduced the same rename error twice:
hold the destination open for reading with `FileShare.ReadWrite` (without delete sharing),
then invoke that archive's `writeCheckpoint`. This is a focused reporter reproduction;
there is no failing browser spec, and the full clean-master suite was not rerun.

```text
CLEAN MASTER FOCUSED SUMMARY: repeats=2 EPERM=2
```

Follow up with transient-lock handling that preserves atomic checkpoints and final counts,
plus a deterministic regression. Keep application test failures visible. The relay branch
continues under the documented baseline-failure exception.
