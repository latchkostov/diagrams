## R2 review verification: two unconfirmed browser failures under full load

The one full Linux gate for runtime commit `dc7b3a4ee71f30d03eb03b2d917dc095ab74cdf6`
used 12 workers and 12 CPUs, ports 6400–6404. All static checks, 12,363 unit tests,
production builds, bundle budgets and all 2,712 parity goldens passed. Two browser cases failed:

- `slowmo.spec.ts:114`, Inputs and capacity Apply fix during slow motion: at line 121,
  `live-play` remained `data-state="paused"` instead of `slowmo`.
- `trace.spec.ts:207`, sequence dialog and Mermaid/SVG/PNG export: the existing whole-test
  30-second backstop expired. The report provides no narrower failed assertion.

```text
SUMMARY: dc7b3a4ee71f30d03eb03b2d917dc095ab74cdf6 | unit={"passed":12363,"failed":0,"skipped":4} parity={"goldens":2712,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1802,"failed":2,"flaky":0,"skipped":0} gate_failures=1
```

Only those two spec files then ran against clean `origin/master`
`1b72a891d57850743420283d4565d9e968b3405f`, in an ignored checkout inside this workspace.
The same Linux worker/CPU count and production-build configuration ran both files twice:
28 passes in each repetition, no failures or flakes. The checkout remained clean.

```text
SUMMARY: 1b72a891d57850743420283d4565d9e968b3405f | unit="not run" parity="not run" e2e={"passed":56,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Pre-existing status is **not established** by that comparison. The identical slow-motion assertion
was previously observed in [the Inputs-entry follow-up](2026-10-19-slowmo-inputs-entry.md).
Investigate entry readiness with Inputs open and sequence/export readiness under broader load;
retain assertions, backstops and zero retries. No UI implementation or browser assertion changed
for these engine fixes. The verification-budget instruction limits the comparison to the failing
specs and permits pushing the recorded result without repeating full suites.

Local reports: `tests/.output/r2-review-full-gate.log`, `tests/.output/g/rCX3oQJ/`,
`tests/.output/r2-review-master-focused.log`, and
`tests/.output/r2-review-clean-master/tests/.output/g/rPz56Uz/`.
