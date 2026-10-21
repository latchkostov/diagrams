## Export fallback downloads stalled during one full Linux gate

The full Linux gate on `94685a63c2fe1b4a3b9a950cafcff37929b1e9a2` reported three failures in
`tests/e2e/image-slices.spec.ts`: PNG/SVG export without Worker, without OffscreenCanvas, and without
either. Each reached the SVG download check at line 429; `download.failure()` remained pending until
the test timeout closed the context, then returned `canceled`. The preceding full gate on
`50c1d2d1102e3dcaefab97887250965c68df1dd9` passed these three cases. The application sources are the
same between those commits; the later commit updates legacy test assertions and verification docs.

## Scoped evidence

One clean archive of `origin/master` (`a243a07342537b7a85d714a216406e444101c4d1`) ran only the affected
spec twice. The branch then ran the same scoped replay twice. Both used the gate's pinned Linux
browser image, production bundles and twelve workers/CPUs. Each revision passed all 56 cases with
zero failures or flakes. These results do not establish that the full-run failure is pre-existing.

```text
SUMMARY: 94685a63c2fe1b4a3b9a950cafcff37929b1e9a2 | unit={"passed":13457,"failed":0,"skipped":4} parity={"goldens":2897,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1968,"failed":3,"flaky":0,"skipped":0} gate_failures=1
SUMMARY: a243a07342537b7a85d714a216406e444101c4d1 | unit="not run" parity="not run" e2e={"passed":56,"failed":0,"flaky":0,"skipped":0} gate_failures=0
SUMMARY: 94685a63c2fe1b4a3b9a950cafcff37929b1e9a2 | unit="not run" parity="not run" e2e={"passed":56,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Follow-up

Investigate download completion and resource pressure in the complete Linux browser run if CI
reproduces this. Preserve the download/content assertions and test timeout. No export implementation,
assertion, worker limit or timeout was changed to hide the failures. The verification-budget rule
limits the clean-master check to this spec and two repeats; delivery records both results for CI.
