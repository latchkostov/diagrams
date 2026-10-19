## PR #189 full-gate workload failures

The final executable change is `3fc05404bc0710d25caa893dcf5907d60a8e306e`. Its Linux archive gate used
12 workers and 12 CPUs, with zero retries. Static checks, unit coverage, production build, entry/viewer size
and every output golden passed. The all-project browser invocation completed all 1,773 checks with nine failures:

```text
SUMMARY: 3fc05404bc0710d25caa893dcf5907d60a8e306e | unit={"passed":11761,"failed":0,"skipped":4} parity={"goldens":2672,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1764,"failed":9,"flaky":0,"skipped":0} gate_failures=1
```

Failures were whole-test timeouts in the language/revert reload flow; German share/password/unlock dialogs;
German and Arabic embed/library dialogs; large-import boundary selection; the P1 live Inspector flow;
cancellable image export; and embedded latency-detail scrolling. The ninth failure was the overlap audit's
fit-readiness assertion while a tooltip was open. These test files are unchanged from origin/master.

Only the eight failed case locations were then selected (the localized cases expand to 13 checks), twice,
on clean origin/master `093e2057231fd7de3293335d34ba75bf1fa775db`. The gate runner's subset API retained
the same Linux archive transport, production profiles, 12 workers and 12 CPUs; no full master suite was run:

```text
SUMMARY: 093e2057231fd7de3293335d34ba75bf1fa775db | unit="not run" parity="not run" e2e={"passed":26,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The identical focused comparison on the branch also passed:

```text
SUMMARY: 3fc05404bc0710d25caa893dcf5907d60a8e306e | unit="not run" parity="not run" e2e={"passed":26,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

These nine failures were observed only in the complete invocation; their cause is unconfirmed, and they are
not classified as reproduced clean-master failures. Reproduce the full-suite concurrency or preceding workload
before changing their implementation. Keep the existing assertions, fit-readiness waits and timeouts.
The separate [annotation keyboard race](2026-10-18-annotation-keyboard-load-races.md) did reproduce on clean master.

The simulation regressions, including temporary reversions, passed after restoration. The final focused engine
and controller run passed 387 tests; five Linux load repetitions of the affected browser specs passed 135 checks
with zero failures or flaky results. No simulation golden changed; only catalog metadata for the recovery notice
was intentionally updated. The commit after the executable change records this verification evidence only.
