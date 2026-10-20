## Linux full-gate browser failures

The annotation palette follow-up's single full Linux gate passed static checks, all 12,884 unit tests (four skipped), production build/size, skill checks and all 2,717 parity goldens. Browser results were 1,822 passed, four failed, zero flaky. The unchanged pending-locale command test and the new Add shape picker test passed.

Four existing Chromium cases failed:

- `canvas.spec.ts`: "export downloads valid diagrams/v1 JSON and import round-trips it" hit the 30-second test backstop.
- `canvas.spec.ts`: "export preserves the complete diagram contract before and after import and reload" could not find the Exported toast after saving a download.
- `privacy-audit.spec.ts`: "filling storage works whatever is stored already" hit the 30-second test backstop.
- `private-diagrams.spec.ts`: "Duplicate and pasted nodes keep the diagram private; an example refuses the paste" hit the 30-second test backstop.

## One clean-master comparison

An isolated source archive of origin/master `5dfc39bf42442ab5fe62c8043fbd8aa3d07368ee` ran only those three specs in the same Linux image, with 12 workers/12 CPUs and two repeats. All 5,910 regular tracked files in that archive were hash-checked against master with zero differences. Both repeats passed all 84 cases: 168 passed, zero failed, zero flaky. The four full-run failures therefore **are not proven pre-existing**. Keep their assertions and investigate if CI repeats them; no timeout, assertion or product behavior was weakened. The requested verification budget calls for recording this one comparison and pushing, without another full-suite run.

## Exact gate summaries and provenance

The full gate ran after `pnpm sync` rewrote merge history. Its tree is byte-for-byte identical to preserved-history feature commit `53b8827c3ebe1e1d416724c0515bfa9f9e5c7cf5` (`git diff --exit-code` passed). The original history was restored before pushing. The source archive lives beneath this checkout, so its quick gate reports the enclosing checkout's SHA; its tested source is the master archive named above.

```text
SUMMARY: 7325f7e355f27fa5b92fc057d020aa0965cc18e7 | unit={"passed":12884,"failed":0,"skipped":4} parity={"goldens":2717,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":1822,"failed":4,"flaky":0,"skipped":0} gate_failures=1
SUMMARY: 53b8827c3ebe1e1d416724c0515bfa9f9e5c7cf5 | unit="not run" parity="not run" e2e={"passed":168,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```
