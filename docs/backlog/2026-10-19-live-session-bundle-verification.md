## Live session bundle repair: sequence-export timeout under full load

The full Linux gate for runtime commit `7def9a1c29cc105ebaf48bff3d54d227bb6aad5f`
used 12 workers and 12 CPUs. All static checks, 12,590 unit tests, production builds,
entry size checks and 2,712 parity goldens passed. One browser test timed out:
`trace.spec.ts:207`, sequence dialog and Mermaid/SVG/PNG export, exceeded its existing
30-second whole-test backstop. The other 1,808 browser tests passed with zero flakes.

```text
SUMMARY: 7def9a1c29cc105ebaf48bff3d54d227bb6aad5f | unit={"passed":12590,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1808,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

The identical case already failed a full gate on pre-fix runtime commit
`dc7b3a4ee71f30d03eb03b2d917dc095ab74cdf6`, which still imported the trace card statically.
See [the earlier R2 verification record](2026-10-19-engine-attempts-r2-browser-verification.md).
That establishes that this failure predates the bundle repair; it does not establish
reproduction on clean master.

Only `trace.spec.ts` then ran twice on clean `origin/master`
`7fdd5bdc4dd9fa0b701190f2c3215834b98cfbf2`, in an ignored checkout inside this workspace,
using the same Linux production-build configuration, 12 workers and 12 CPUs. Both
repetitions passed all 11 tests. The checkout remained clean before and after the probe.

```text
SUMMARY: 7fdd5bdc4dd9fa0b701190f2c3215834b98cfbf2 | unit="not run" parity="not run" e2e={"passed":22,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Clean-master reproduction remains unconfirmed. The verification-budget instruction calls
for recording this single focused comparison and pushing rather than repeating full suites.
No timeout, assertion, production simulation behavior or golden was changed to accommodate
the failure. Investigate sequence/export readiness under broad full-suite load in the existing
follow-up. The bundle repair itself passed 2,159 targeted simulation/build tests, its deliberate
static-import regression, and five consecutive stable-tree UI repetitions (745 passes).

One earlier UI repetition was invalidated by rebasing while its source-mounted dev server
was running: the server read the engine during an intermediate checkout state and could not
resolve a module. The five subsequent stable-tree repetitions passed without failures or flakes.

Reports: `tests/.output/bundle-full-gate.log`, `tests/.output/g/rPMtb3u/`,
`tests/.output/bundle-master-trace-probe.log`, and
`tests/.output/bm-204/tests/.output/g/rzcEZWK/`.
