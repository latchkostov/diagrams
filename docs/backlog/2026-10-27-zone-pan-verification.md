## Sync fixture timeout during concurrent verification

The Windows unit project for the zone-label pan fix reported 13,221 passed,
one failed, five expected failures and ten skipped. The failure was
`src/lib/sync.test.ts`, “reloads upstream policy after checkout (conflicted
output: false) and ends clean”: its existing 5,000 ms whole-test backstop fired
under concurrent Linux browser and unit work. The reported case took 14,151 ms.

The same source is unchanged from clean `origin/master` at
`6dd721901`. An ignored local proof clone of that revision ran only this spec
twice: 15 passed each time. A focused rerun on the fix branch also passed all
15 tests. The failure therefore was not reproduced on clean master, and the
original full-project failure must stay visible in the verification report.
No assertion, timeout or budget was changed. Investigate synchronous Git fixture
work and filesystem contention if CI reproduces it.

Local evidence: `tests/.output/zone-all-units.log`,
`tests/.output/zone-master-sync-{1,2}.log` and
`tests/.output/zone-sync-rerun.log`.

## Overview whole-test timeouts on clean master

The two-pass Linux camera/showcase run reported 243 passed and one light Overview
whole-test timeout. The five-pass affected-spec run also encountered the light and
dark “large Overview names every individual card and zone, and filters routes”
cases reaching the existing 30,000 ms whole-test backstop. The mid-gesture pan/zoom
regressions pass; no geometric assertion was loosened.

Clean `origin/master` at `aa6a4090b9a0e6e6c65c67bb5eeaeabac95976d7`
ran only `workbench-overview.spec.ts` twice. Two workers/two CPUs passed all 16
cases. Matching the affected run's six workers/four CPUs reproduces both the light
and dark whole-test timeouts in both repetitions (12 passed, four failed).
This is a pre-existing load failure; investigate its work before raising any
timeout. No application source or test assertion was changed to hide it.

Local evidence: `tests/.output/zone-master-overview.log`,
`tests/.output/zone-master-overview-loaded.log`, and the reports under
`tests/.output/g/{rArPvaQ,rDSNmaC}/`.

```text
SUMMARY: aa6a4090b9a0e6e6c65c67bb5eeaeabac95976d7 | unit="not run" parity="not run" e2e={"passed":12,"failed":4,"flaky":0,"skipped":0} gate_failures=2
```

## Interrupted Fit frame-bound observation

The fourth affected-spec repetition failed `fit-settled.spec.ts`, “the canvas
mutation observer disconnects after an interrupted animated fit”, at its existing
100-frame bound while waiting for Fit to start moving the viewport. The other
four repetitions of that case passed. Clean master at the revision above ran
only `fit-settled.spec.ts` twice with six workers/four CPUs: 60 passed, zero failed.
This failure was not reproduced on clean master and remains an unresolved load
observation; retain its trace rather than weakening the frame bound.

Local evidence: `tests/.output/zone-master-fit-loaded.log` and
`tests/.output/g/rDSNmaC/e4/results/`.

## Final affected-spec result

The Edit and Live mid-gesture regression passed all ten cases across five loaded
repetitions. The seven failures below are six Overview whole-test timeouts and
the single interrupted Fit frame-bound failure documented above.

```text
SUMMARY: 4fec2933344b1a85e1a69d8537af1281615d612a | unit="not run" parity="not run" e2e={"passed":243,"failed":7,"flaky":0,"skipped":0} gate_failures=3
```
