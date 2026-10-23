## Export and privacy timeouts in the full load run

The single full Linux gate on `1ad46686c8af27dfcfe191b1399cf5e42c5c27da`
passed static checks, 14,974 unit checks, build, size and all 3,111 parity goldens.
Its browser result was 2,100 passed / five failed, with no flaky or skipped cases.

One failure was the requested Inputs/slow-motion case. Its trace completed all
assertions, but the 6,000-orders/s background capture consumed 14.7 seconds and the
case reached its 30-second backstop. The fixture was subsequently reduced to
1,200 orders/s at quarter capacity, preserving the enabled Apply fix and every disabled/recovery assertion.

The other four failures were unchanged specs: the no-open-diagram refusal action in
`sharing-privacy.spec.ts` (the toast action was gone at its final click), the existing
animation-clock-origin check in `skill-html.spec.ts`, live blob exports in
`viewer-bundle.spec.ts`, and imported/duplicated metadata in `ai-privacy.spec.ts`'s
dev project. Three hit the whole-test backstop; viewer-bundle could not find Play.

Only those four specs were replayed twice from an immutable clean master archive
at `643f61b6dc94a64248c8ffd152f69bd979d9ebb4`, with twelve workers/twelve CPUs:

`SUMMARY: 643f61b6dc94a64248c8ffd152f69bd979d9ebb4 | unit="not run" parity="not run" e2e={"passed":62,"failed":0,"flaky":0,"skipped":0} gate_failures=0`

None reproduced in that focused replay. These are load follow-ups, not confirmed
pre-existing failures or diagnosed product bugs. Preserve the assertions and
investigate expiry control, lazy readiness and fixture work without raising
timeouts. No full clean-master suite was run.
