## Light-theme Inspector contrast under load

The existing `a11y.spec.ts` light-theme Inspector scan intermittently reports a 4.38:1 contrast ratio for foreground `#656d80` over `#ececed` at 11.5 px, below the required 4.5:1. This is separate from the new selected shaped-edge scan, which passes in both themes.

The identical failure reproduced on an unchanged archive of origin/master `069291556bb345348d306ef171a4fcde7a4d8e81`, with frozen dependencies and the pinned Linux Playwright image. Only `a11y.spec.ts` was run, twice, using four workers/four CPUs and ports 6860–6864. The first repetition passed all 40 tests; the second passed 39 and failed the light-theme Inspector scan with the same colours and ratio.

```text
SUMMARY: 069291556bb345348d306ef171a4fcde7a4d8e81 | unit="not run" parity="not run" e2e={"passed":79,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Inspect the actual field/background state and fix its contrast without weakening axe or changing the line-editing scope. The keyboard/touch branch's load run hits the same existing scan; its new shaped-edge scans pass.
