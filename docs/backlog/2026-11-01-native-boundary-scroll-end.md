## A reached boundary is not the end of a native gesture

The latency driver's `scrollGesture` accepted either `scrollend` or the requested boundary after two animation frames. That boundary fallback is necessary when an input starts at the boundary and produces no scroll event, but it also released gestures that had just moved there. The next keyboard input could run before the preceding gesture's actual completion.

The driver now records whether it started at the requested boundary. Only that no-movement case can use the existing input-delivery acknowledgement without `scrollend`; a gesture that reaches the boundary must acknowledge its real completion. Product scrolling, the exact Home=0 assertion, every timeout and the existing boundary tolerance remain unchanged.

## Verification

A new regression holds delivery of the real native `scrollend` while allowing the wheel to reach the boundary. The driver must remain pending, then finish when delivery is released. Temporarily restoring the old fallback fails this regression; the existing initial-boundary regression still passes.

The entire latency spec passes twice on Windows with two CPUs and three workers (30 executions), including the short-viewport case previously reported at line 244. Both full Linux container repetitions pass (30 executions). These are local results; the dispatched final-head Nightly in PR #411 must confirm macOS separately. No macOS Home failure is declared fixed from the Windows reproduction alone.

```text
SUMMARY: afff54d82e4d54bfe81e5475c9f0a61d4c4d84a3 | unit="not run" parity="not run" e2e={"passed":30,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

The change affects only the E2E driver and its regression. The earlier product-fix validation remains applicable: all 3,178 parity goldens unchanged, build, size, the affected renderer/protocol units and all 30 reserve heavy cases pass. No output, UI text, generated schema or skill source changes.
