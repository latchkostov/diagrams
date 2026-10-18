## Paused slow-motion camera holds during Inspector resizing

Resizing the Inspector now preserves the exact viewport of a paused slow-motion replay,
including an unfinished follow pan. Policy row W1b stops the camera immediately when the
pane changes; W5 still waits for measured geometry before replanning a playing, fitted
replay. Previously W5 stopped the pan only after two matching frames, allowing the
paused camera to ease farther during the resize. Effect timing and animation durations
are unchanged.

The original production-build assertion fails on master `21c17fe3` (27 passed, one failed),
with the same transforms as the two resolved backlog entries. Table tests cover immediate
suspension and deferred menus; fixed controller regressions cover both scheduled and running
follow transitions with delayed pane measurements. Removing W1b's stop makes both regressions
fail. The existing exact-transform and single-stop E2E assertions remain unchanged.

## Report-only Windows teardown evidence

Nightly has a separate `windows-latest` job that runs only the four quarantined slow-motion
cases, three times, with zero retries. Its explicit Nightly-only opt-in enables those cases
without editing their quarantine annotations. The job cannot fail other jobs' verdict or
enter the failure issue's dependency list. It always uploads gate reports, failure traces,
browser-process logs and synchronous per-test JSONL teardown probes.

Before context close the probe records open workers, MediaRecorder states, main-thread rAF
and timer handles, OffscreenCanvas creation/transfers, fetches waiting for headers and
network requests waiting for completion. It logs worker closure and context-close begin/end
to distinguish browser shutdown from trace finalization. It does not inspect worker-internal
timer handles. Local Windows dry runs pass all 12 target executions; the original GitHub
runner stalls still need evidence before any quarantine is removed.

Full output parity checks all 2,196 goldens: zero changed, added, missing or stale.
No golden is re-recorded.

## Verification

- Native unit suite: 10,650 passed, four existing skips; build and entry size pass.
- Camera and slow-motion properties: three fresh random runs at 20× coverage, all pass.
- Original Inspector production spec: 28 passed with its assertions unchanged.
- Diagnostic Windows dry run: four target cases × three repetitions, all 12 pass.
- Linux load: all nine affected/neighbour specs × five repetitions, eight workers on
  four CPUs: 610 passed, zero failed, flaky or skipped.
