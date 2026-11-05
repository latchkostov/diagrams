## Complete Linux gate and targeted baseline

The single complete Linux gate on `9f048581eb14231ddf9ae6f30ae2e7921420ca6b`
used six workers and CPUs. Static checks, the unit and heavy lanes, build, size,
self-host smoke and parity passed. Every caching check and all 51 checks in the
three previously timing-out download specs passed. Two other browser checks
failed:

- `lazy-main-renderer.spec.ts`: the worker-failure fallback stayed at one painted
  frame while paused; the assertion requires more than one after SVG export.
- `resilience-retries.spec.ts`: `retry-upgrade-preview` did not appear. The trace
  showed the palette query `m properties` after typing `diagram properties`.

```text
SUMMARY: 9f048581eb14231ddf9ae6f30ae2e7921420ca6b | unit={"passed":16852,"failed":0,"skipped":13} parity={"goldens":3358,"changed":0,"added":0,"missing":0,"stale":0} e2e={"passed":3484,"failed":2,"flaky":0,"skipped":12} gate_failures=1
```

Only those two specs then ran twice on clean `origin/master` at
`85bc26c10b4480177568cf98a9812e683225c7fd`, in this same worktree, with six Linux
workers and CPUs. All 22 checks passed. The feature branch was restored. No full
master suite ran. These are therefore **not proven identical pre-existing
failures**.

```text
SUMMARY: 85bc26c10b4480177568cf98a9812e683225c7fd | unit="not run" parity="not run" e2e={"passed":22,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

## Resolutions

The palette had a layout-to-passive focus gap in its input capture. A separate
repair keeps the prefix captured until the passive focus setup; its deterministic
regression loses `diagra` when the old layout handoff is restored. The original
retry-upgrade assertion and timeout stay unchanged.

The renderer counter counts actual paints, and the renderer intentionally skips
unchanged paints while paused. The test now makes a real viewport change after
export, keeps the original greater-than-one assertion, and additionally requires
growth beyond the pre-change paint count while still paused. This exercises the
active drawing loop without relying on incidental font or layout changes to
produce a second paint. No renderer behavior, counter, assertion threshold or
timeout is weakened.

## Follow-up verification

With these edits applied, the command-palette, retry, annotation, drawing,
viewport, platform and Inspector neighbours passed five Linux repetitions at
six workers and CPUs: 745 passed, zero failed and zero flaky. The renderer,
retry and command-palette specs then passed five repetitions under the same
load: 120 passed, zero failed and zero flaky. Removing the viewport stimulus
made both renderer variants fail the new growth check; restoring the old
palette handoff lost the typed prefix in its deterministic regression.

The follow-up's 40 targeted units, production build, size, skill and i18n checks
passed. Parity checked all 3,358 goldens with none changed, added, missing or
stale. The complete suite was not repeated, following the verification budget.
