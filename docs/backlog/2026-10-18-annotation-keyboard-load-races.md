## Annotation keyboard races under Linux load

During #189 verification, an 8-worker/4-CPU Linux run missed the first link when tabbing through an annotation.
A later 12-worker/12-CPU run missed Ctrl+B immediately after opening an annotation editor: the text remained
`critical`, and `data-markdown-ready` appeared only after the key had been pressed. These are editor flows;
the fractional-occupancy correction changes no annotation or formatting implementation.

The annotation spec was checked once on a clean local checkout of origin/master
`093e2057231fd7de3293335d34ba75bf1fa775db`, with two repetitions, four workers and two CPUs:

```text
SUMMARY: 093e2057231fd7de3293335d34ba75bf1fa775db | unit="not run" parity="not run" e2e={"passed":64,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Repeating only that spec at the branch run's matching load (12 workers, 12 CPUs, two repetitions) reproduced
the same missing formatting shortcut in both clean-master repetitions:

```text
SUMMARY: 093e2057231fd7de3293335d34ba75bf1fa775db | unit="not run" parity="not run" e2e={"passed":62,"failed":2,"flaky":0,"skipped":0} gate_failures=2
```

The formatting failure is confirmed on clean master; the earlier link-focus miss remains unconfirmed.
Keep the focus and formatting assertions. Investigate first-key handling while the formatting chunk loads,
and deferred focus after entering an annotation. Do not mask either case with a readiness wait in the
existing first-key test or a larger timeout.
