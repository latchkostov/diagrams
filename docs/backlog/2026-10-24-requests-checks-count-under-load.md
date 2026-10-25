## Requests Checks count under Linux load

The PR #290 merge/fix run of `editor.spec.ts`, `password-links.spec.ts` and
`requests-wait-checks.spec.ts` on Linux (three Playwright workers, two CPUs) also found timeouts waiting
for `checks-count` in neighboring requests-checks cases: verified option chips, fixed-replica alternatives
and inspector alternatives, across English, Arabic and pseudo-English. The three failures named in the
brief passed in the first repetition after the integration fix.

The original worker-fallback timeout/Undo case passed ten times on clean master
`8e58be7e421cd6b812d85ec0182a13244d59e8de`, with zero failures or flakes. A separate attempt to check
the neighboring failures twice on master could not acquire the shared gate budget (exit 75), including
a one-worker request behind an existing waiter. Their baseline status is unconfirmed; do not classify
them as known master failures without reproduction.

Reproduce only the affected cases on master and compare their checks readiness under load. Keep the
existing assertions and timeouts. Reports for this local run are under `tests/.output/g/rID8tlN/`;
the successful ten-run master diagnostic is under
`tests/.output/master-290/tests/.output/g/r7sT1sm/`. No checks or simulation code was changed in this fix.
