## HTML artifact download timeouts under Linux load

The second of P-05's five eight-worker/eight-CPU Linux repetitions hit five existing HTML export cases:
phone playback, custom background in light/dark, invalid colour objects, and the read-only viewer.
They exceeded the existing test backstop while awaiting `download.saveAs()` and reported `canceled`.
Those cases passed in the native family run and in the other four broad Linux repetitions. Assertions,
backstops, export content and goldens were not loosened or re-recorded.

A clean-master check ran only the HTML spec twice on
`62e064a13b31010b15e3ef9a50cdf98968403cff` and did not reproduce the timeouts:

```text
pnpm gate quick tests/e2e/html-export.spec.ts --linux --only e2e --repeat 2 --workers 1 --cpus 1 --max-wait 1
SUMMARY: 62e064a13b31010b15e3ef9a50cdf98968403cff | unit="not run" parity="not run" e2e={"passed":26,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

This limited check does not prove the timeouts are pre-existing: the original failure used eight
workers, and checkout/install disk work overlapped that repetition. Keep the distinction from the
separately reproduced inspector failure. Investigate download artifact I/O and capture the failure
before attributing it to browser output or changing product code.

A subsequent isolated run of the HTML family on the rebased implementation used the original eight
workers/eight CPUs for five repetitions. All 70 cases passed, with no failure or flaky result:

```text
pnpm gate quick tests/e2e/html-export.spec.ts --linux --only e2e --repeat 5 --workers 8 --cpus 8 --max-wait 1
SUMMARY: f49b7a8cdb48a1d2070bc3a8a9dd8aeaa9539ddd | unit="not run" parity="not run" e2e={"passed":70,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

No product change was made to obtain that result. The broad-run artifact timeouts remain an
unreproduced observation, not evidence of a fixed or confirmed pre-existing product defect.
